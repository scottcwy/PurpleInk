import capabilities from "../templates/feature-launch/capabilities-v1.json" with { type: "json" };
import { canonicalJson, hashJson, sha256, assertDeterministicJson } from "./canonical-json.mjs";
import { hyperframesConfig, renderFeatureLaunch } from "./template.mjs";

const DEFAULT_VARIANTS = Object.freeze([
  Object.freeze({ id: "landscape", width: 1920, height: 1080, fps: 30 }),
  Object.freeze({ id: "portrait", width: 1080, height: 1920, fps: 30 })
]);

function fail(message) { throw new TypeError(message); }
function requireEqual(actual, expected, message) { if (actual !== expected) fail(message); }
function checkAllowed(value, list, label) { if (!list.includes(value)) fail(`illegal ${label}: ${value}`); }

function validateVariants(variants) {
  if (!Array.isArray(variants) || variants.length !== 2) fail("exactly landscape and portrait variants are required");
  for (const expected of DEFAULT_VARIANTS) {
    const variant = variants.find((item) => item.id === expected.id);
    if (!variant) fail(`missing ${expected.id} variant`);
    requireEqual(variant.width, expected.width, `${expected.id} width is fixed at ${expected.width}`);
    requireEqual(variant.height, expected.height, `${expected.id} height is fixed at ${expected.height}`);
    if (![30, 60].includes(variant.fps)) fail(`${expected.id} fps must be 30 or 60`);
  }
}

function validateInputs(input) {
  assertDeterministicJson(input);
  const { plan, brandKit, assetPackage, templateVersion, outputVariants, compilerVersion, hyperframesVersion } = input;
  if (!plan || plan.schemaVersion !== "launch-video-plan/v1") fail("invalid LaunchVideoPlanV1");
  if (!brandKit || !assetPackage) fail("brandKit and assetPackage are required");
  for (const value of [templateVersion, compilerVersion, hyperframesVersion]) if (typeof value !== "string" || !value) fail("all compiler version fields are required");
  requireEqual(templateVersion, capabilities.templateVersion, "unsupported template version");
  requireEqual(plan.templateVersion, templateVersion, "plan template version mismatch");
  requireEqual(plan.releaseId, brandKit.releaseId, "brand kit belongs to another release");
  requireEqual(plan.releaseId, assetPackage.releaseId, "asset package belongs to another release");
  requireEqual(plan.brandKitVersionId, brandKit.id, "brand kit version mismatch");
  if (brandKit.approvalStatus !== "approved" || brandKit.immutable !== true) fail("brand kit must be approved and immutable");
  if (assetPackage.approvalStatus !== "approved" || assetPackage.immutable !== true) fail("asset package must be approved and immutable");
  for (const [name, color] of Object.entries(brandKit.colors ?? {})) if (!/^#[0-9A-Fa-f]{6}$/.test(color)) fail(`brand color ${name} must be a six-digit hex value`);
  for (const [name, font] of Object.entries(brandKit.fonts ?? {})) if (!/^[A-Za-z0-9 ]{1,80}$/.test(font)) fail(`brand font ${name} is not a safe local font name`);
  if (!Array.isArray(plan.beats) || plan.beats.length < 3 || plan.beats.length > 5) fail("plan must contain 3-5 beats");
  if (!Number.isInteger(plan.durationMs) || plan.durationMs < 15000 || plan.durationMs > 30000) fail("plan duration must be 15-30 seconds");
  validateVariants(outputVariants);

  const evidence = new Map();
  const assetVersionIds = new Set();
  for (const entry of assetPackage.entries ?? []) {
    requireEqual(entry.releaseId, plan.releaseId, `asset ${entry.assetVersionId} belongs to another release`);
    if (entry.approvalStatus !== "approved" || entry.redactionStatus !== "passed" || entry.immutable !== true) fail(`asset ${entry.assetVersionId} is not approved immutable evidence`);
    const bytes = Buffer.from(entry.contentBase64, "base64");
    requireEqual(bytes.length, entry.bytes, `asset ${entry.assetVersionId} byte count mismatch`);
    requireEqual(sha256(bytes), entry.sha256, `asset ${entry.assetVersionId} hash mismatch`);
    if (!/^assets\/[A-Za-z0-9._/-]+$/.test(entry.bundlePath) || entry.bundlePath.split("/").includes("..")) fail(`asset ${entry.assetVersionId} has illegal bundle path`);
    const key = `${entry.nodeEvidenceId}:${entry.assetVersionId}`;
    if (evidence.has(key)) fail(`duplicate asset reference ${key}`);
    if (assetVersionIds.has(entry.assetVersionId)) fail(`duplicate asset version ${entry.assetVersionId}`);
    assetVersionIds.add(entry.assetVersionId);
    evidence.set(key, entry);
  }

  let cursor = 0;
  for (const beat of plan.beats) {
    requireEqual(beat.startMs, cursor, `beat ${beat.id} creates overlap or gap`);
    cursor += beat.durationMs;
    checkAllowed(beat.layoutId, capabilities.layoutIds, "layoutId");
    checkAllowed(beat.motionPresetId, capabilities.motionPresetIds, "motionPresetId");
    checkAllowed(beat.transitionId, capabilities.transitionIds, "transitionId");
    for (const id of beat.capabilityIds ?? []) checkAllowed(id, capabilities.capabilityIds, "capabilityId");
    if ((beat.headline?.length ?? 0) > capabilities.copyLimits.headlineMaxChars || (beat.body?.length ?? 0) > capabilities.copyLimits.bodyMaxChars) fail(`beat ${beat.id} exceeds template copy limits`);
    if (!Array.isArray(beat.evidence) || beat.evidence.length === 0) fail(`beat ${beat.id} requires approved evidence`);
    for (const reference of beat.evidence) {
      const entry = evidence.get(`${reference.nodeEvidenceId}:${reference.assetVersionId}`);
      if (!entry) fail(`beat ${beat.id} references missing or mismatched evidence`);
      if (!entry.sceneIds.includes(beat.sceneId)) fail(`evidence ${entry.nodeEvidenceId} is not approved for scene ${beat.sceneId}`);
    }
  }
  requireEqual(cursor, plan.durationMs, "beat timeline must exactly fill plan duration");
  return evidence;
}

export function compile(input) {
  const evidenceByReference = validateInputs(input);
  const files = {};
  const assetMap = {};
  for (const entry of input.assetPackage.entries) {
    files[entry.bundlePath] = { encoding: "base64", content: entry.contentBase64 };
    assetMap[entry.assetVersionId] = { nodeEvidenceId: entry.nodeEvidenceId, path: entry.bundlePath, mimeType: entry.mimeType, bytes: entry.bytes, sha256: entry.sha256 };
  }
  for (const variant of [...input.outputVariants].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const entry of input.assetPackage.entries) files[`variants/${variant.id}/${entry.bundlePath}`] = { encoding: "base64", content: entry.contentBase64 };
    files[`variants/${variant.id}/index.html`] = { encoding: "utf8", content: renderFeatureLaunch({ plan: input.plan, variant, evidenceByReference, brandKit: input.brandKit }) };
    files[`variants/${variant.id}/hyperframes.json`] = { encoding: "utf8", content: hyperframesConfig() };
  }
  const generatedFiles = Object.fromEntries(Object.keys(files).sort().map((path) => {
    const file = files[path];
    const bytes = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
    return [path, { bytes: bytes.length, sha256: sha256(bytes) }];
  }));
  const manifestCore = {
    schemaVersion: "composition-bundle/v1",
    releaseId: input.plan.releaseId,
    durationMs: input.plan.durationMs,
    compilerVersion: input.compilerVersion,
    hyperframesVersion: input.hyperframesVersion,
    templateVersion: input.templateVersion,
    inputHashes: {
      plan: hashJson(input.plan), brandKit: hashJson(input.brandKit), assetPackage: hashJson(input.assetPackage), outputVariants: hashJson(input.outputVariants)
    },
    variants: [...input.outputVariants].sort((a, b) => a.id.localeCompare(b.id)).map((variant) => ({ ...variant, rootComposition: `variants/${variant.id}/index.html` })),
    assetMap,
    generatedFiles
  };
  const bundleHash = hashJson(manifestCore);
  const manifest = { ...manifestCore, bundleHash };
  files["manifest.json"] = { encoding: "utf8", content: `${canonicalJson(manifest)}\n` };
  return { bundleHash, manifest, files };
}

export const OUTPUT_VARIANTS_V1 = DEFAULT_VARIANTS;
