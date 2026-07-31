import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("publishes immutable amd64 Web, Worker, and migration images from main", async () => {
  const workflow = await read(".github/workflows/main-images.yml");

  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /pnpm\/action-setup@v4/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /image:\s*\n\s*- web\s*\n\s*- worker/);
  assert.match(
    workflow,
    /image:\s*\n\s*- web\s*\n\s*- worker\s*\n\s*- migrate/
  );
  assert.match(workflow, /type=raw,value=main/);
  assert.match(workflow, /type=sha,prefix=sha-/);
  assert.match(workflow, /platforms:\s*linux\/amd64/);
  assert.match(workflow, /push:\s*true/);
});

test("builds a dedicated one-shot Postgres migration image", async () => {
  const dockerfile = await read("Dockerfile.migrate");

  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /scripts\/setup\/db-migrate\.ts/);
  assert.match(dockerfile, /src\/lib\/db\/migrations\/pg/);
  assert.match(dockerfile, /CMD \["pnpm", "db:migrate"\]/);
  assert.ok(
    dockerfile.indexOf("pnpm install --frozen-lockfile") <
      dockerfile.indexOf("ENV NODE_ENV=production"),
    "migration build must install tsx before production mode is enabled"
  );
});

test("builds a standalone pnpm Web image for the internal Worker", async () => {
  const dockerfile = await read("Dockerfile.web");
  const nextConfig = await read("next.config.ts");
  const rootLayout = await read("src/app/layout.tsx");

  assert.match(dockerfile, /pnpm-lock\.yaml/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /BACKEND_ORIGIN=http:\/\/worker:8787/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
  assert.match(nextConfig, /output:\s*["']standalone["']/);
  assert.doesNotMatch(rootLayout, /next\/font\/google/);
});

test("builds the Worker with matching Playwright and pnpm dependencies", async () => {
  const dockerfile = await read("Dockerfile.worker");
  const packageJson = JSON.parse(await read("package.json"));

  assert.equal(packageJson.dependencies.playwright, "1.62.0");
  assert.match(dockerfile, /FROM node:24-bookworm-slim/);
  assert.match(dockerfile, /Acquire::Retries=3/);
  assert.match(dockerfile, /playwright install --with-deps chromium/);
  assert.match(dockerfile, /pnpm-lock\.yaml/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /COPY --chown=node:node src\/lib\/tts/);
  assert.match(
    dockerfile,
    /CMD \["pnpm", "--filter", "purpleink-server", "start"\]/
  );
});

test("exposes only Caddy and pins both application images to one tag", async () => {
  const compose = await read("deploy/compose.yaml");
  const caddyfile = await read("deploy/Caddyfile");

  assert.match(
    compose,
    /ghcr\.io\/scottcwy\/purpleink-web:\$\{IMAGE_TAG:\?set IMAGE_TAG\}/
  );
  assert.match(
    compose,
    /ghcr\.io\/scottcwy\/purpleink-worker:\$\{IMAGE_TAG:\?set IMAGE_TAG\}/
  );
  assert.match(
    compose,
    /ghcr\.io\/scottcwy\/purpleink-migrate:\$\{IMAGE_TAG:\?set IMAGE_TAG\}/
  );
  assert.match(compose, /BACKEND_ORIGIN:\s*http:\/\/worker:8787/);
  assert.match(compose, /ports:\s*\n\s*- "80:80"\s*\n\s*- "443:443"/);
  assert.equal((compose.match(/\n\s+ports:/g) ?? []).length, 1);
  assert.match(caddyfile, /protocols h1 h2/);
  assert.match(caddyfile, /reverse_proxy web:3000/);
  assert.doesNotMatch(caddyfile, /reverse_proxy worker:8787/);
});

test("keeps Postgres internal and persists its data", async () => {
  const compose = await read("deploy/compose.yaml");

  assert.match(compose, /postgres:\s*\n\s*image: postgres:17\.5-alpine/);
  assert.match(
    compose,
    /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?set POSTGRES_PASSWORD\}/
  );
  assert.match(compose, /postgres_data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /pg_isready -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB/);
  assert.equal((compose.match(/\n\s+ports:/g) ?? []).length, 1);
  assert.match(compose, /\n\s+postgres_data:\s*$/m);
});

test("injects database secrets into Web and gates health on the workbench", async () => {
  const compose = await read("deploy/compose.yaml");

  assert.match(compose, /DATABASE_URL: \$\{DATABASE_URL:\?set DATABASE_URL\}/);
  assert.match(
    compose,
    /CVC_CREDENTIAL_MASTER_KEY: \$\{CVC_CREDENTIAL_MASTER_KEY:\?set CVC_CREDENTIAL_MASTER_KEY\}/
  );
  assert.match(
    compose,
    /fetch\('http:\/\/127\.0\.0\.1:3000\/products\/dashboard'\)/
  );
  assert.match(
    compose,
    /migrate:\s*\n\s*image: ghcr\.io\/scottcwy\/purpleink-migrate/
  );
  assert.match(compose, /profiles:\s*\n\s*- tools/);
});

test("keeps credentials and generated media out of image build contexts", async () => {
  const dockerignore = await read(".dockerignore");

  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^server\/\.env\*$/m);
  assert.match(dockerignore, /^server\/out$/m);
  assert.match(dockerignore, /^\.git$/m);
});
