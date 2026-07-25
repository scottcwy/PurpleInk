import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8").catch(
    () => ""
  );
}

const composeSource = await read("deploy/compose.yaml");
const compose = parse(composeSource) ?? {};
const caddyfile = await read("deploy/Caddyfile");
const workflowSource = await read(".github/workflows/dev-images.yml");
const workflow = parse(workflowSource) ?? {};
const webDockerfile = await read("Dockerfile.web");
const workerDockerfile = await read("Dockerfile.worker");
const nextConfig = await read("next.config.ts");
const launchComposer = await read("components/launch-composer.tsx");
const rootLayout = await read("app/layout.tsx");
const siteConfigSource = await read("lib/config.ts");
const metadataSource = await read("lib/metadata.ts");
const webTsconfig = JSON.parse(await read("tsconfig.json"));
const webPackage = JSON.parse(await read("package.json"));
const workerPackage = JSON.parse(await read("server/package.json"));

test("defines exactly the Caddy, Web, and Worker services", () => {
  assert.deepEqual(Object.keys(compose.services ?? {}).sort(), [
    "caddy",
    "web",
    "worker",
  ]);
});

test("publishes only Caddy HTTP and HTTPS ports", () => {
  assert.deepEqual(compose.services?.caddy?.ports, ["80:80", "443:443"]);
  assert.equal(compose.services?.web?.ports, undefined);
  assert.equal(compose.services?.worker?.ports, undefined);
  assert.deepEqual(compose.services?.web?.expose, ["3000"]);
  assert.deepEqual(compose.services?.worker?.expose, ["8787"]);
});

test("keeps the anonymous API closed while serving the public Web app", () => {
  assert.match(caddyfile, /@blocked_api\s+path\s+\/api\s+\/api\/\*/);
  assert.match(caddyfile, /handle\s+@blocked_api\s*\{[\s\S]*?respond\s+404/);
  assert.match(caddyfile, /reverse_proxy\s+web:3000/);
  assert.doesNotMatch(caddyfile, /reverse_proxy\s+worker:8787/);
  assert.match(caddyfile, /protocols\s+h1\s+h2/);
});

test("uses private GHCR images with an explicit immutable tag", () => {
  assert.equal(
    compose.services?.web?.image,
    "ghcr.io/scottcwy/purpleink-web:${IMAGE_TAG:?set IMAGE_TAG}"
  );
  assert.equal(
    compose.services?.worker?.image,
    "ghcr.io/scottcwy/purpleink-worker:${IMAGE_TAG:?set IMAGE_TAG}"
  );
});

test("builds both amd64 images when lowercase dev changes", () => {
  assert.deepEqual(workflow.on?.push?.branches, ["dev"]);
  assert.equal(workflow.permissions?.packages, "write");
  assert.deepEqual(workflow.jobs?.images?.strategy?.matrix?.image, [
    "web",
    "worker",
  ]);
  assert.match(workflowSource, /linux\/amd64/);
  assert.match(workflowSource, /type=sha,prefix=sha-/);
  assert.match(workflowSource, /push:\s*true/);
});

test("builds a standalone public Web image with rendering disabled", () => {
  assert.match(nextConfig, /output:\s*["']standalone["']/);
  assert.match(webDockerfile, /ARG NEXT_PUBLIC_RENDER_ENABLED=false/);
  assert.match(
    launchComposer,
    /process\.env\.NEXT_PUBLIC_RENDER_ENABLED\s*===\s*["']true["']/
  );
  assert.match(launchComposer, /Launch Video \u5373\u5c06\u5f00\u653e/);
});

test("keeps production builds independent from remote font downloads", () => {
  assert.doesNotMatch(rootLayout, /next\/font\/google/);
});

test("publishes PurpleInk metadata on the deployment domain", () => {
  const publicConfig = `${siteConfigSource}\n${metadataSource}`;
  assert.match(publicConfig, /https:\/\/shuheng\.cloud/);
  assert.match(metadataSource, /name:\s*["']PurpleInk["']/);
  assert.doesNotMatch(publicConfig, /nexus-ai\.com|Nexus AI|React Bits Pro/);
});

test("keeps the Worker TypeScript project outside the Web build", () => {
  assert.ok(webTsconfig.exclude?.includes("server"));
});

test("uses the patched Next.js runtime for the public Web service", () => {
  assert.equal(webPackage.dependencies?.next, "16.2.11");
  assert.equal(webPackage.devDependencies?.["eslint-config-next"], "16.2.11");
  assert.equal(webPackage.overrides?.postcss, "8.5.23");
  assert.equal(webPackage.overrides?.sharp, "0.35.3");
});

test("uses a Playwright worker image and persistent output storage", () => {
  assert.match(
    workerDockerfile,
    /mcr\.microsoft\.com\/playwright:v1\.49\.0-noble/
  );
  assert.match(workerDockerfile, /ffmpeg/);
  assert.match(workerDockerfile, /USER pwuser/);
  assert.match(
    workerDockerfile,
    /COPY --chown=pwuser:pwuser server \.\/server/
  );
  assert.doesNotMatch(workerDockerfile, /chown -R/);
  assert.match(
    workerDockerfile,
    /ln -s \/app\/server\/node_modules \/app\/node_modules/
  );
  assert.deepEqual(compose.services?.worker?.volumes, [
    "./data:/app/server/out",
  ]);
});

test("bakes the pinned HyperFrames runtime into the Worker image", () => {
  assert.equal(workerPackage.dependencies?.hyperframes, "0.7.68");
  assert.match(workerDockerfile, /RUN npm ci/);
});
