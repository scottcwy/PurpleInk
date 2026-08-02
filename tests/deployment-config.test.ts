import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = process.cwd();

type ZeaburEnvironment = Record<
  string,
  { default?: string; expose?: boolean; readonly?: boolean }
>;

interface ZeaburService {
  name: string;
  template: "GIT" | "PREBUILT";
  dependencies?: string[];
  spec: {
    id: string;
    source: {
      image?: string;
      github?: { branch?: string; repoID?: number };
    };
    env?: ZeaburEnvironment;
    ports?: unknown[];
    volumes?: Array<{ dir?: string; id?: string }>;
  };
}

interface ZeaburTemplate {
  apiVersion: string;
  kind: string;
  spec: { services: ZeaburService[] };
}

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

async function missing(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath));
    return false;
  } catch {
    return true;
  }
}

async function deploymentTemplate(): Promise<{
  raw: string;
  template: ZeaburTemplate;
}> {
  const raw = await text("deploy/zeabur.template.yaml");
  return { raw, template: parse(raw) as ZeaburTemplate };
}

function service(template: ZeaburTemplate, name: string): ZeaburService {
  const match = template.spec.services.find(
    (candidate) => candidate.name === name
  );
  expect(match, `missing Zeabur service: ${name}`).toBeDefined();
  return match as ZeaburService;
}

function defaults(
  environment: ZeaburEnvironment | undefined
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment ?? {}).map(([key, value]) => [
      key,
      value.default,
    ])
  );
}

describe("Zeabur production deployment", () => {
  it("pins PostgreSQL 17.5 and builds exactly Web, Worker, Migrate, and Backup from zeabur/deploy", async () => {
    const { raw, template } = await deploymentTemplate();

    expect(template.apiVersion).toBe("zeabur.com/v1");
    expect(template.kind).toBe("Template");
    expect(template.spec.services.map(({ name }) => name).sort()).toEqual([
      "backup",
      "migrate",
      "postgresql",
      "web",
      "worker",
    ]);

    const postgresql = service(template, "postgresql");
    expect(postgresql.template).toBe("PREBUILT");
    expect(postgresql.spec.source.image).toBe("postgres:17.5");
    expect(postgresql.spec.volumes).toEqual([
      { id: "data", dir: "/var/lib/postgresql/data" },
    ]);

    for (const name of ["web", "worker", "migrate", "backup"]) {
      const application = service(template, name);
      expect(application.template).toBe("GIT");
      expect(application.spec.source.github).toMatchObject({
        branch: "zeabur/deploy",
      });
      expect(application.spec.source.github?.repoID).toEqual(
        expect.any(Number)
      );
    }

    expect(service(template, "worker").dependencies ?? []).not.toContain(
      "postgresql"
    );
    expect(raw).not.toMatch(
      /ghcr\.io|PURPLEINK_IMAGE_TAG|image-tag-guard|caddy/i
    );
  });

  it("keeps provider, billing, mail, database, and future R2 settings on Web", async () => {
    const { template } = await deploymentTemplate();
    const webEnvironment = defaults(service(template, "web").spec.env);

    expect(webEnvironment).toMatchObject({
      BACKEND_ORIGIN: "http://worker.zeabur.internal:8787",
      DATABASE_URL: "${POSTGRES_CONNECTION_STRING}",
      CVC_CREDENTIAL_MASTER_KEY: "",
      CVC_REDEMPTION_CODE_PEPPER: "",
      PURPLEINK_ENGINE_INTERNAL_KEY: "",
      CVC_MANAGED_STEPFUN_API_KEY: "",
      CVC_MANAGED_MIMO_API_KEY: "",
      CVC_MANAGED_GEMINI_API_KEY: "",
      CVC_MANAGED_OPENAI_API_KEY: "",
      CVC_MANAGED_ANTHROPIC_API_KEY: "",
      CVC_MAIL_SMTP_HOST: "",
      CVC_MAIL_SMTP_PORT: "",
      CVC_MAIL_SMTP_USER: "",
      CVC_MAIL_SMTP_PASS: "",
      CVC_MAIL_FROM_ADDRESS: "",
      CVC_MAIL_FROM_NAME: "PurpleInk",
      STORAGE_MODE: "s3-mirror",
      S3_ENDPOINT: "",
      S3_BUCKET: "",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
    });
  });

  it("gives Worker only its internal service contract and routes AI calls to Web", async () => {
    const { template } = await deploymentTemplate();
    const workerEnvironment = defaults(service(template, "worker").spec.env);

    expect(workerEnvironment).toEqual({
      NODE_ENV: "production",
      PORT: "8787",
      PURPLEINK_AI_GATEWAY_ORIGIN: "http://web.zeabur.internal:3000",
      PURPLEINK_ENGINE_INTERNAL_KEY: "",
      BROWSER_DRIVER: "playwright",
      PURPLEINK_COMPOSE_MODE: "auto",
      PURPLEINK_FFMPEG_DIR: "",
    });
    expect(Object.keys(workerEnvironment)).not.toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "CVC_CREDENTIAL_MASTER_KEY",
        "CVC_REDEMPTION_CODE_PEPPER",
        "STORAGE_MODE",
        "S3_ENDPOINT",
        "S3_BUCKET",
        "S3_REGION",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ])
    );
    expect(Object.keys(workerEnvironment).join("\n")).not.toMatch(
      /DATABASE|POSTGRES|PROVIDER|MODEL|PRICE|BILLING|CVC_MANAGED|S3_|R2_/
    );

    expect(defaults(service(template, "migrate").spec.env)).toEqual({
      DATABASE_URL: "${POSTGRES_CONNECTION_STRING}",
    });
  });

  it("gives Backup only its database and R2 boundary with no ports or volumes", async () => {
    const { template } = await deploymentTemplate();
    const backup = service(template, "backup");

    expect(backup.template).toBe("GIT");
    expect(backup.spec.source.github).toMatchObject({
      branch: "zeabur/deploy",
    });
    expect(backup.dependencies).toEqual(["postgresql"]);
    expect(backup.spec.ports).toBeUndefined();
    expect(backup.spec.volumes).toBeUndefined();

    const backupEnvironment = defaults(backup.spec.env);
    expect(backupEnvironment).toEqual({
      DATABASE_URL: "${POSTGRES_CONNECTION_STRING}",
      S3_ENDPOINT: "",
      S3_BUCKET: "",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
      PG_BACKUP_PREFIX: "backups/postgres/",
      PG_BACKUP_RETAIN: "14",
    });
    expect(Object.keys(backupEnvironment).join("\n")).not.toMatch(
      /CVC_MANAGED_|CVC_MAIL_|STORAGE_MODE|PURPLEINK_/
    );
  });

  it("builds four Node 22 images with their minimum runtime closures", async () => {
    const [web, worker, migrate, backup] = await Promise.all([
      text("Dockerfile.web"),
      text("Dockerfile.worker"),
      text("Dockerfile.migrate"),
      text("Dockerfile.backup"),
    ]);

    for (const dockerfile of [web, worker, migrate, backup]) {
      expect(dockerfile).toMatch(/^FROM node:22-bookworm-slim/m);
      expect(dockerfile).toContain("COPY patches patches");
      expect(dockerfile).toContain(
        "COPY packages/procedural-sfx/package.json packages/procedural-sfx/package.json"
      );
      expect(dockerfile.indexOf("COPY patches patches")).toBeLessThan(
        dockerfile.indexOf("pnpm install --frozen-lockfile")
      );
      expect(
        dockerfile.indexOf(
          "COPY packages/procedural-sfx/package.json packages/procedural-sfx/package.json"
        )
      ).toBeLessThan(dockerfile.indexOf("pnpm install --frozen-lockfile"));
    }

    expect(web).toContain(
      "ARG BACKEND_ORIGIN=http://worker.zeabur.internal:8787"
    );
    expect(web).toContain("ARG NEXT_PUBLIC_SITE_URL");
    expect(web).toContain("ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}");
    expect(web).toContain("COPY --from=build /repo/.next/standalone ./");
    expect(web).toContain(
      "COPY --from=build /repo/.next/static ./.next/static"
    );
    expect(web).toContain("COPY --from=build /repo/public ./public");
    expect(web).toContain("install-deps chromium");
    expect(web).toContain("USER pwuser");
    expect(web).toContain('CMD ["node", "server.js"]');

    expect(worker).toContain("ffmpeg");
    expect(worker).toContain("ffprobe -version");
    expect(worker).toContain("WORKDIR /repo/server");
    expect(worker).toContain(
      "node ./node_modules/playwright/cli.js install-deps chromium"
    );
    expect(worker).toContain(
      "node ./node_modules/playwright/cli.js install chromium"
    );
    expect(worker).toContain(
      "COPY packages/procedural-sfx ./packages/procedural-sfx"
    );
    expect(worker).toContain(
      "src/features/ai/worker-gateway-contract.ts /repo/src/features/ai/worker-gateway-contract.ts"
    );
    expect(
      worker
        .split("\n")
        .filter((line) => line.startsWith("COPY") && /\ssrc\//.test(line))
    ).toEqual([
      expect.stringContaining("src/features/ai/worker-gateway-contract.ts"),
    ]);
    expect(worker).toContain("USER pwuser");
    expect(worker).toContain('CMD ["node_modules/.bin/tsx", "src/index.ts"]');

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
    expect(migrate).not.toMatch(/COPY (assets|public|server\/src)/);
    expect(migrate).toContain('CMD ["pnpm", "db:migrate"]');

    expect(backup).not.toContain("COPY . .");
    expect(backup).toContain("postgresql-client-17");
    expect(backup).not.toMatch(/node:24|postgresql-client-18/);
    expect(backup).toContain(
      'CMD ["pnpm", "tsx", "scripts/backup/schedule.ts"]'
    );
  });

  it("removes the Compose, Caddy, GHCR guard, and browser harness runtime", async () => {
    for (const relativePath of [
      "Dockerfile",
      "server/Dockerfile",
      "deploy/Caddyfile",
      "deploy/compose.yaml",
      "deploy/env.example",
      "docker-compose.prod.yml",
      "scripts/deploy/validate-image-tag.mjs",
      "scripts/verify/predev-browser",
      "tests/predev-browser-contracts.test.ts",
    ]) {
      expect(
        await missing(relativePath),
        `obsolete deployment path: ${relativePath}`
      ).toBe(true);
    }

    const packageJson = await text("package.json");
    expect(packageJson).not.toContain("deploy:validate-tag");
    expect(packageJson).not.toContain("validate-image-tag.mjs");
  });

  it("runs existing gates and builds all service images without registry publishing", async () => {
    const workflow = await text(".github/workflows/ci.yml");

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
    for (const dockerfile of [
      "./Dockerfile.web",
      "./Dockerfile.worker",
      "./Dockerfile.migrate",
      "./Dockerfile.backup",
    ]) {
      expect(workflow).toContain(dockerfile);
    }

    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("version: 10.30.0");
    expect(workflow).toContain("push: false");
    expect(workflow).not.toMatch(/docker\/login-action|ghcr\.io|push:\s*true/i);
    expect(workflow).not.toMatch(/packages:\s*write/i);
    expect(workflow).not.toMatch(/validate-image-tag|docker compose/i);
  });

  it("keeps secrets out of image contexts and documents Zeabur as the only production path", async () => {
    const [dockerignore, readme] = await Promise.all([
      text(".dockerignore"),
      text("deploy/README.md"),
    ]);

    for (const pattern of [".env", ".env.*", "docs", "tests", "node_modules"]) {
      expect(dockerignore).toContain(pattern);
    }
    expect(readme).toContain("Zeabur");
    expect(readme).toContain("zeabur/deploy");
    expect(readme).toContain("deploy/zeabur.template.yaml");
    expect(readme).not.toMatch(/GHCR|Caddy|Docker Compose|immutable image/i);
  });

  it("documents Zeabur and R2 as the active deployment truth with retired files removed", async () => {
    const readme = await text("README.md");

    for (const relativePath of [
      "docs/deployment/zeabur-plan.md",
      "docs/deployment/zeabur-setup.md",
      "docs/integration/zeabur-predev-integration-2026-08-02.md",
    ]) {
      expect(
        await missing(relativePath),
        `missing active deployment doc: ${relativePath}`
      ).toBe(false);
    }
    for (const relativePath of [
      "docs/deployment/access.md",
      "docs/deployment/runbook.md",
    ]) {
      expect(
        await missing(relativePath),
        `retired deployment doc still present: ${relativePath}`
      ).toBe(true);
    }

    expect(readme).toContain("Node.js 22");
    expect(readme).not.toContain("Node.js 24");
  });

  it("keeps the Zeabur plan and setup docs free of retired production guidance", async () => {
    const [plan, setup] = await Promise.all([
      text("docs/deployment/zeabur-plan.md"),
      text("docs/deployment/zeabur-setup.md"),
    ]);

    for (const doc of [plan, setup]) {
      expect(doc).toMatch(/Zeabur/i);
      expect(doc).toContain("PostgreSQL 17.5");
      expect(doc).toMatch(/R2/i);
      expect(doc).toContain("PURPLEINK_ENGINE_INTERNAL_KEY");
      expect(doc).toContain("worker.zeabur.internal");
      expect(doc).not.toMatch(
        /GHCR|Caddy|docker compose|docker-compose|compose\.yaml|PURPLEINK_IMAGE_TAG|immutable image/i
      );
    }

    expect(plan).toContain("web.zeabur.internal");
    expect(setup).toContain("PG_BACKUP_RETAIN");
  });

  it("points routing.md at the Zeabur private-service boundary instead of the retired proxy contract", async () => {
    const routing = await text("docs/conventions/routing.md");

    expect(routing).toContain("web.zeabur.internal");
    expect(routing).toContain("worker.zeabur.internal");
    expect(routing).not.toMatch(/access\.md/i);
    expect(routing).not.toMatch(/Caddy/i);
  });
});
