import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = process.cwd();

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("immutable production deployment", () => {
  it("pins the compatibility entrypoint to the production project name", async () => {
    const compatibility = parse(await text("docker-compose.prod.yml")) as {
      include?: Array<{ path?: string }>;
      name?: string;
    };

    expect(compatibility.name).toBe("purpleink");
    expect(compatibility.include).toEqual([{ path: "./deploy/compose.yaml" }]);
  });

  it("bootstraps Debian HTTPS certificates over HTTP before installing runtime packages", async () => {
    for (const relativePath of ["Dockerfile", "server/Dockerfile"]) {
      const dockerfile = await text(relativePath);
      const httpsSources = "sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources";
      const firstAptUpdate = dockerfile.indexOf("apt-get update");
      const httpsAptUpdate = dockerfile.lastIndexOf("apt-get update");

      expect(dockerfile).toContain(httpsSources);
      expect(firstAptUpdate).toBeGreaterThanOrEqual(0);
      expect(firstAptUpdate).toBeLessThan(dockerfile.indexOf("ca-certificates"));
      expect(dockerfile.indexOf("ca-certificates")).toBeLessThan(dockerfile.indexOf(httpsSources));
      expect(dockerfile.indexOf(httpsSources)).toBeLessThan(httpsAptUpdate);
      expect(httpsAptUpdate).toBeLessThan(dockerfile.lastIndexOf("fonts-wqy-zenhei"));
      expect(dockerfile.match(/Acquire::Retries=5/g)).toHaveLength(2);
      expect(dockerfile.match(/Acquire::http::Timeout=30/g)).toHaveLength(2);
    }
  });

  it("uses three immutable application images behind the only published Caddy ports", async () => {
    const compose = parse(await text("deploy/compose.yaml")) as {
      services: Record<string, Record<string, unknown>>;
      networks: Record<string, Record<string, unknown>>;
    };
    const services = compose.services;

    expect(Object.keys(services).sort()).toEqual([
      "caddy",
      "image-tag-guard",
      "migrate",
      "postgres",
      "web",
      "worker",
    ]);
    expect(services.web.image).toBe(
      "ghcr.io/scottcwy/purpleink-web:${PURPLEINK_IMAGE_TAG:?set PURPLEINK_IMAGE_TAG to sha-<40 lowercase hex>}"
    );
    expect(services.worker.image).toBe(
      "ghcr.io/scottcwy/purpleink-worker:${PURPLEINK_IMAGE_TAG:?set PURPLEINK_IMAGE_TAG to sha-<40 lowercase hex>}"
    );
    expect(services.migrate.image).toBe(
      "ghcr.io/scottcwy/purpleink-migrate:${PURPLEINK_IMAGE_TAG:?set PURPLEINK_IMAGE_TAG to sha-<40 lowercase hex>}"
    );
    expect(services.web).not.toHaveProperty("build");
    expect(services.worker).not.toHaveProperty("build");
    expect(services.migrate).not.toHaveProperty("build");

    expect(services.caddy.ports).toEqual(["80:80", "443:443"]);
    for (const serviceName of [
      "postgres",
      "web",
      "worker",
      "migrate",
      "image-tag-guard",
    ]) {
      expect(services[serviceName]).not.toHaveProperty("ports");
    }
    expect(compose.networks).toMatchObject({
      app: { driver: "bridge" },
      data: { driver: "bridge", internal: true },
      edge: { driver: "bridge" },
    });
    expect(services.caddy.networks).toEqual(["edge", "app"]);
    expect(services.web.networks).toEqual(["app", "data"]);
    expect(services.worker.networks).toEqual(["app"]);
    expect(services.migrate.networks).toEqual(["data"]);
    expect(services.postgres.networks).toEqual(["data"]);
    expect(services["image-tag-guard"].network_mode).toBe("none");
  });

  it("keeps the Worker environment to its service contract", async () => {
    const compose = parse(await text("deploy/compose.yaml")) as {
      services: Record<string, { environment?: Record<string, unknown> }>;
    };
    const workerEnvironment = compose.services.worker.environment ?? {};
    const workerKeys = Object.keys(workerEnvironment);

    expect(workerEnvironment).toEqual({
      NODE_ENV: "production",
      PORT: "8787",
      PURPLEINK_AI_GATEWAY_ORIGIN: "http://web:3000",
      PURPLEINK_ENGINE_INTERNAL_KEY:
        "${PURPLEINK_ENGINE_INTERNAL_KEY:?set PURPLEINK_ENGINE_INTERNAL_KEY}",
      BROWSER_DRIVER: "${BROWSER_DRIVER:-playwright}",
      PURPLEINK_COMPOSE_MODE: "${PURPLEINK_COMPOSE_MODE:-auto}",
      PURPLEINK_FFMPEG_DIR: "${PURPLEINK_FFMPEG_DIR:-}",
    });
    expect(
      workerKeys.some((key) =>
        /DATABASE|IMAP|SIGNUP|PROVIDER|MODEL|PRICE|BILLING|CVC_MANAGED_/.test(key)
      )
    ).toBe(false);

    expect(compose.services.web.environment).toMatchObject({
      BACKEND_ORIGIN: "http://worker:8787",
      CVC_CREDENTIAL_MASTER_KEY:
        "${CVC_CREDENTIAL_MASTER_KEY:?set CVC_CREDENTIAL_MASTER_KEY}",
      DATA_DIR: "/app/.data",
      DATABASE_URL:
        "postgres://cvc:${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}@postgres:5432/cvc",
      PURPLEINK_ENGINE_INTERNAL_KEY:
        "${PURPLEINK_ENGINE_INTERNAL_KEY:?set PURPLEINK_ENGINE_INTERNAL_KEY}",
    });
  });

  it("ships a strict sha tag guard and a migration image with only its source closure", async () => {
    const validator = await import("../scripts/deploy/validate-image-tag.mjs");
    expect(validator.isImmutableImageTag(`sha-${"a".repeat(40)}`)).toBe(true);
    for (const invalid of [
      "dev",
      "main",
      "sha-deadbee",
      `sha-${"A".repeat(40)}`,
    ]) {
      expect(validator.isImmutableImageTag(invalid)).toBe(false);
    }

    const dockerfile = await text("Dockerfile");
    expect(dockerfile).toContain("FROM deps AS migrate");
    expect(dockerfile).toContain('ENTRYPOINT ["pnpm", "db:migrate"]');
    const migrate = dockerfile.slice(
      dockerfile.indexOf("FROM deps AS migrate"),
      dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime")
    );
    expect(migrate).not.toContain("COPY . .");
    for (const source of [
      "tsconfig.json",
      "scripts/setup/db-migrate.ts",
      "src/lib/db/migrate.ts",
      "src/lib/db/schema",
      "src/lib/db/migrations/pg",
    ]) {
      expect(migrate).toContain(source);
    }
    expect(dockerfile).toContain("COPY --from=build /repo/.next/standalone ./");
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });

  it("runs Worker from its server directory with installed Playwright and ffmpeg tools", async () => {
    const dockerfile = await text("server/Dockerfile");
    expect(dockerfile).toContain("ffmpeg");
    expect(dockerfile).toContain("ffprobe -version");
    expect(dockerfile).toContain("WORKDIR /repo/server");
    expect(dockerfile).toContain(
      "node ./node_modules/playwright/cli.js install-deps chromium"
    );
    expect(dockerfile).toContain("/etc/apt/apt.conf.d/80purpleink-retries");
    expect(dockerfile).toContain(
      "node ./node_modules/playwright/cli.js install chromium"
    );
    expect(dockerfile).not.toMatch(/npx\s+--yes\s+playwright/);
    expect(dockerfile).toContain('CMD ["node_modules/.bin/tsx", "src/index.ts"]');

    const compose = parse(await text("deploy/compose.yaml")) as {
      services: Record<string, { volumes?: string[] }>;
    };
    expect(compose.services.worker.volumes).toEqual([
      "cvc_worker_out:/repo/server/out",
      "cvc_worker_capture:/repo/server/capture",
    ]);
  });

  it("excludes secrets, docs, tests, and repository source from Web runtime layers", async () => {
    const dockerignore = await text(".dockerignore");
    for (const pattern of [
      ".env",
      ".env.*",
      "docs",
      "tests",
      "**/*.test.ts",
      "**/*.test.tsx",
    ]) {
      expect(dockerignore).toContain(pattern);
    }

    const dockerfile = await text("Dockerfile");
    const runtime = dockerfile.slice(
      dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime")
    );
    expect(runtime).not.toContain("COPY . .");
    expect(runtime).not.toContain("/repo/src");
    expect(runtime).not.toContain("/repo/docs");
    expect(runtime).not.toContain("/repo/tests");
    expect(runtime).toContain(
      "COPY --from=deps /repo/node_modules /playwright/node_modules"
    );
    expect(runtime).toContain(
      "node /playwright/node_modules/playwright/cli.js install-deps chromium"
    );
    expect(runtime).toContain("/etc/apt/apt.conf.d/80purpleink-retries");
  });

  it("runs all gates for PR and predev, and publishes only dev sha images after checks", async () => {
    const workflow = await text(".github/workflows/ci.yml");

    expect(workflow).toContain("- predev");
    expect(workflow).toContain("- dev");
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toMatch(/^\s+- (main|master)\s*$/m);
    for (const command of [
      "pnpm lint",
      "pnpm typecheck",
      "pnpm --filter purpleink-server typecheck",
      "pnpm --filter @purpleink/procedural-sfx typecheck",
      "pnpm test",
      "pnpm --filter @purpleink/procedural-sfx test",
      "pnpm db:migrate",
      "pnpm test:pg",
      "pnpm verify:v3",
      "pnpm verify:workflow",
      "pnpm build",
    ]) {
      expect(workflow).toContain(command);
    }
    expect(workflow).toContain("github.ref == 'refs/heads/dev'");
    expect(workflow).toContain("docker/login-action@v3");
    expect(workflow).toContain("sha-${{ github.sha }}");
    expect(workflow).toContain("value=dev");
    expect(workflow).toContain("version: 10.30.0");
    expect(workflow).toContain("docker compose --env-file deploy/env.example -f deploy/compose.yaml config --quiet");
    expect(workflow).toContain("docker compose --env-file deploy/env.example -f docker-compose.prod.yml config --quiet");
    expect((workflow.match(/push:\s*false/g) ?? []).length).toBe(1);
    expect((workflow.match(/push:\s*true/g) ?? []).length).toBe(1);
  });

  it("sets the Worker backend at Web build time without baking a localhost runtime", async () => {
    const dockerfile = await text("Dockerfile");
    const build = dockerfile.slice(
      dockerfile.indexOf("FROM deps AS build"),
      dockerfile.indexOf("FROM deps AS migrate")
    );
    const runtime = dockerfile.slice(
      dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime")
    );
    expect(build).toContain("ARG BACKEND_ORIGIN=http://worker:8787");
    expect(build).toContain("ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}");
    expect(runtime).not.toContain("BACKEND_ORIGIN=http://localhost:8787");

    const workflow = await text(".github/workflows/ci.yml");
    expect((workflow.match(/build-args: \|\s*\n\s+BACKEND_ORIGIN: http:\/\/worker:8787/g) ?? []).length).toBe(2);
  });

  it("requires explicit production CIDRs and strips IMAP and signup inputs from deployment material", async () => {
    const compose = await text("deploy/compose.yaml");
    const envExample = await text("deploy/env.example");
    const runbook = await text("docs/deployment/runbook.md");

    expect(compose).toContain(
      'CVC_ALLOWED_CIDRS: "${CVC_ALLOWED_CIDRS:?set CVC_ALLOWED_CIDRS to approved CIDRs}"'
    );
    expect(envExample).toContain("CVC_ALLOWED_CIDRS=203.0.113.0/24 2001:db8::/32");
    expect(envExample).not.toMatch(/^(IMAP_|SIGNUP_)/m);
    expect(runbook).toContain("Get-Content deploy/.env");
    expect(runbook).toContain("public website capture");
  });

  it("records Caddy plus application sessions as the current access contract", async () => {
    const routing = await text("docs/conventions/routing.md");
    const smokeSession = await text("scripts/verify/smoke-session.ts");
    expect(routing).not.toContain("Basic Auth");
    expect(smokeSession).not.toContain("CVC_VERIFY_BASIC_AUTH");
    expect(smokeSession).not.toContain("basicAuthHeaders");
  });

  it("keeps root verification examples on the application-session contract", async () => {
    const rootEnvExample = await text(".env.example");
    const e2eSmoke = await text("scripts/verify/e2e-smoke.ts");
    expect(rootEnvExample).not.toContain("CVC_VERIFY_BASIC_AUTH");
    expect(e2eSmoke).not.toContain("Basic Auth");
    expect(e2eSmoke).toContain("Application session");
  });

  it("marks superseded Basic Auth deployment plans as historical", async () => {
    for (const relativePath of [
      "docs/issues/ISSUE-015-production-issue.md",
      "docs/plans/PLAN-001-p2-p6-p7-production-deployment.md",
    ]) {
      expect(await text(relativePath)).toContain(
        "Historical note: the current deployment contract is deploy/compose.yaml"
      );
    }
  });

  it("keeps Caddy security headers and streaming proxy behavior", async () => {
    const caddyfile = await text("deploy/Caddyfile");
    for (const contract of [
      "X-Content-Type-Options nosniff",
      "X-Frame-Options DENY",
      "Referrer-Policy strict-origin-when-cross-origin",
      "Permissions-Policy",
      "flush_interval -1",
      "reverse_proxy web:3000",
    ]) {
      expect(caddyfile).toContain(contract);
    }
  });
});
