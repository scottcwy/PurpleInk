import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const fixtureRoot = resolve(packageRoot, "fixtures/golden-feature-launch");
const inputValidator = resolve(repoRoot, "skills/product-launch-video/scripts/validate-input.mjs");
const outputValidator = resolve(repoRoot, "skills/product-launch-video/scripts/validate-output.mjs");

function runValidator(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("golden skill input and output pass schema and provenance validation", async () => {
  const input = resolve(fixtureRoot, "skill-input.json"); const plan = resolve(fixtureRoot, "plan.json");
  assert.equal(runValidator(inputValidator, [input]).status, 0);
  assert.equal(runValidator(outputValidator, [plan, "--input", input]).status, 0);
});

test("skill input validator rejects cross-release and unapproved evidence", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "purpleink-skill-test-"));
  try {
    const input = JSON.parse(await readFile(resolve(fixtureRoot, "skill-input.json"), "utf8"));
    input.evidencePackage.entries[0].releaseId = "release-other";
    input.evidencePackage.entries[1].approvalStatus = "pending";
    const path = resolve(directory, "invalid-input.json"); await writeFile(path, JSON.stringify(input));
    const result = runValidator(inputValidator, [path]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /another release|must equal|approved/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("skill output validator rejects a layout outside TemplateCapabilities", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "purpleink-plan-test-"));
  try {
    const plan = JSON.parse(await readFile(resolve(fixtureRoot, "plan.json"), "utf8")); plan.beats[0].layoutId = "arbitrary-html";
    const path = resolve(directory, "invalid-plan.json"); await writeFile(path, JSON.stringify(plan));
    const result = runValidator(outputValidator, [path, "--input", resolve(fixtureRoot, "skill-input.json")]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /illegal layoutId/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
