import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const distDir = process.env.CVC_NEXT_DIST_DIR || ".next";
const standaloneRoot = path.resolve(distDir, "standalone");
const forbiddenTopLevel = [
  "AGENTS.md",
  "README.md",
  "PRD_PurpleInk.md",
  "docs",
  "scripts",
  "tests",
];
const allowedWebpackTraceSources = new Set([
  "src/features/audio/narration-queue-handler.ts",
  "src/features/director/frontier-reconciliation.ts",
  "src/features/director/stage-effects.ts",
  "src/features/website/index.ts",
  "src/features/website/website-queue-handler.ts",
  "src/lib/queue/execution-reconciliation.ts",
  "src/lib/queue/queue-claim.ts",
]);

async function listFiles(root, relativeRoot = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function directorySize(root) {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await directorySize(absolutePath);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += (await stat(absolutePath)).size;
      files += 1;
    }
  }

  return { bytes, files };
}

test("standalone artifact excludes repository sources and loads Playwright", async () => {
  const topLevel = (await readdir(standaloneRoot)).sort();
  const leaked = forbiddenTopLevel.filter((entry) => topLevel.includes(entry));

  assert.deepEqual(leaked, [], `repository files leaked: ${leaked.join(", ")}`);

  const tracedSources = (await listFiles(standaloneRoot)).filter((file) =>
    file.startsWith("src/")
  );
  const unexpectedSources = tracedSources.filter(
    (file) => !allowedWebpackTraceSources.has(file)
  );
  assert.deepEqual(
    unexpectedSources,
    [],
    `unexpected traced source files: ${unexpectedSources.join(", ")}`
  );

  const runtimeRequire = createRequire(path.join(standaloneRoot, "server.js"));
  const playwrightPath = runtimeRequire.resolve("playwright");
  const browsersJsonPath = runtimeRequire.resolve(
    "playwright-core/browsers.json"
  );
  const playwright = runtimeRequire("playwright");
  const browsers = runtimeRequire(browsersJsonPath);
  const fonts = await readdir(path.join(standaloneRoot, "assets", "fonts"));

  assert.ok(playwright.chromium, `Playwright failed to load from ${playwrightPath}`);
  assert.ok(Array.isArray(browsers.browsers));
  assert.ok(browsers.browsers.length > 0);
  assert.ok(fonts.length > 0, "standalone assets/fonts is empty");

  const inventory = await directorySize(standaloneRoot);
  console.log(
    JSON.stringify({
      standaloneRoot,
      topLevel,
      bytes: inventory.bytes,
      files: inventory.files,
      playwrightPath,
      browsersJsonPath,
      fonts,
    })
  );
});
