import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureBundle = resolve(
  packageRoot,
  "fixtures/golden-feature-launch/bundle"
);
const qualityGate = resolve(packageRoot, "scripts/quality-gate.mjs");

test("quality gate uses the Hyperframes version pinned by the bundle manifest", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "purpleink-quality-version-")
  );
  const bundleRoot = resolve(directory, "bundle");
  const reportPath = resolve(directory, "quality-report.json");
  const renderRoot = resolve(directory, "renders");
  try {
    await cp(fixtureBundle, bundleRoot, { recursive: true });
    const manifestPath = resolve(bundleRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.variants = manifest.variants.filter(
      (variant) => variant.id === "landscape"
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

    const result = spawnSync(
      process.execPath,
      [qualityGate, bundleRoot, reportPath, renderRoot],
      {
        encoding: "utf8",
        timeout: 120_000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    assert.equal(
      report.variants.landscape.inspect._meta.version,
      manifest.hyperframesVersion
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
