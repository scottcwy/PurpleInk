import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("publishes immutable amd64 Web and Worker images from main", async () => {
  const workflow = await read(".github/workflows/main-images.yml");

  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /pnpm\/action-setup@v4/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /image:\s*\n\s*- web\s*\n\s*- worker/);
  assert.match(workflow, /type=raw,value=main/);
  assert.match(workflow, /type=sha,prefix=sha-/);
  assert.match(workflow, /platforms:\s*linux\/amd64/);
  assert.match(workflow, /push:\s*true/);
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
  assert.match(compose, /BACKEND_ORIGIN:\s*http:\/\/worker:8787/);
  assert.match(compose, /ports:\s*\n\s*- "80:80"\s*\n\s*- "443:443"/);
  assert.equal((compose.match(/\n\s+ports:/g) ?? []).length, 1);
  assert.match(caddyfile, /protocols h1 h2/);
  assert.match(caddyfile, /reverse_proxy web:3000/);
  assert.doesNotMatch(caddyfile, /reverse_proxy worker:8787/);
});

test("keeps credentials and generated media out of image build contexts", async () => {
  const dockerignore = await read(".dockerignore");

  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^server\/\.env\*$/m);
  assert.match(dockerignore, /^server\/out$/m);
  assert.match(dockerignore, /^\.git$/m);
});
