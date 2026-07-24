import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compile } from "../src/compile.mjs";
import { sha256 } from "../src/canonical-json.mjs";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden-feature-launch");

async function fixtureInput() {
  const input = JSON.parse(await readFile(resolve(fixtureRoot, "input.json"), "utf8"));
  for (const entry of input.assetPackage.entries) {
    const bytes = await readFile(resolve(fixtureRoot, entry.fixturePath));
    entry.contentBase64 = bytes.toString("base64"); entry.bytes = bytes.length; entry.sha256 = sha256(bytes); delete entry.fixturePath;
  }
  return input;
}

test("same immutable input produces the same bundle hash and bytes", async () => {
  const input = await fixtureInput();
  const first = compile(input); const second = compile(structuredClone(input));
  assert.equal(first.bundleHash, second.bundleHash);
  assert.deepEqual(first.files, second.files);
});

test("bundle contains independent 16:9 and 9:16 root compositions", async () => {
  const bundle = compile(await fixtureInput());
  assert.match(bundle.files["variants/landscape/index.html"].content, /data-width="1920" data-height="1080"/);
  assert.match(bundle.files["variants/portrait/index.html"].content, /data-width="1080" data-height="1920"/);
  assert.deepEqual(bundle.manifest.variants.map((variant) => variant.id), ["landscape", "portrait"]);
});

test("bundle locks locale and approved EvidencePackageVersion provenance", async () => {
  const input = await fixtureInput();
  input.plan.locale = "en-US";
  input.plan.evidencePackageVersionId = input.assetPackage.id;
  const bundle = compile(input);

  assert.equal(bundle.manifest.locale, "en-US");
  assert.equal(
    bundle.manifest.evidencePackageVersionId,
    input.assetPackage.id
  );
  const anotherLocale = structuredClone(input);
  anotherLocale.plan.locale = "ja-JP";
  assert.notEqual(compile(anotherLocale).bundleHash, bundle.bundleHash);
});

test("rejects corrupted evidence", async () => {
  const input = await fixtureInput(); input.assetPackage.entries[0].contentBase64 = Buffer.from("wrong evidence").toString("base64");
  assert.throws(() => compile(input), /byte count mismatch|hash mismatch/);
});

test("rejects cross-release assets", async () => {
  const input = await fixtureInput(); input.assetPackage.entries[0].releaseId = "release-other";
  assert.throws(() => compile(input), /belongs to another release/);
});

test("rejects unapproved assets", async () => {
  const input = await fixtureInput(); input.assetPackage.entries[0].approvalStatus = "pending";
  assert.throws(() => compile(input), /not approved immutable evidence/);
});

test("rejects illegal layouts", async () => {
  const input = await fixtureInput(); input.plan.beats[0].layoutId = "freeform-html";
  assert.throws(() => compile(input), /illegal layoutId/);
});

test("rejects non-deterministic non-JSON input", async () => {
  const input = await fixtureInput(); input.runtimeClock = new Date();
  assert.throws(() => compile(input), /JSON data only/);
});

test("rejects timeline gaps", async () => {
  const input = await fixtureInput(); input.plan.beats[1].startMs += 1;
  assert.throws(() => compile(input), /overlap or gap/);
});
