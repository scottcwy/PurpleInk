import { createHash } from "node:crypto";
import Ajv from "ajv";
import inputSchema from "../schemas/input-v1.schema.json" with { type: "json" };
import planSchema from "../schemas/launch-video-plan-v1.schema.json" with { type: "json" };

const schemas = new Map([
  ["input-v1.schema.json", inputSchema],
  ["launch-video-plan-v1.schema.json", planSchema],
]);

export async function validateSchema(value, schemaName) {
  const schema = schemas.get(schemaName);
  if (!schema) throw new Error(`unknown product-launch-video schema: ${schemaName}`);
  const ajv = new Ajv({ allErrors: true, jsonPointers: true });
  const validate = ajv.compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => `${error.dataPath || "/"} ${error.message}`);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function evidenceRefKey(ref) {
  if (ref?.kind === "node_evidence") return `node_evidence:${ref.nodeEvidenceId}:${ref.assetVersionId}`;
  if (ref?.kind === "source_asset") return `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`;
  return "invalid_evidence_ref";
}

export function evidencePackageDigest(entries) {
  const lockedEntries = entries.map(({ contentBase64: _content, ...entry }) => entry).sort((a, b) => evidenceRefKey(a.ref).localeCompare(evidenceRefKey(b.ref)));
  return sha256(canonicalJson(lockedEntries));
}

export function provenanceErrors(input) {
  const errors = [];
  const ownerKeys = ["workspaceId", "productId", "releaseId"];
  for (const [label, record] of [["storyboard", input.storyboard], ["brandKit", input.brandKit], ["evidencePackage", input.evidencePackage]]) {
    for (const key of ownerKeys) if (record?.[key] !== input[key]) errors.push(`${label}.${key} must equal input.${key}`);
  }
  if (input.storyboard?.id !== input.storyboardVersionId) errors.push("storyboard.id must equal storyboardVersionId");
  if (input.brandKit?.id !== input.brandKitVersionId) errors.push("brandKit.id must equal brandKitVersionId");
  if (input.evidencePackage?.id !== input.evidencePackageVersionId) errors.push("evidencePackage.id must equal evidencePackageVersionId");
  if (input.templateCapabilities?.templateVersion !== input.templateVersion) errors.push("templateCapabilities.templateVersion must equal templateVersion");

  const sceneIds = new Set();
  for (const scene of input.storyboard?.scenes ?? []) {
    if (sceneIds.has(scene.id)) errors.push(`duplicate storyboard scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    if (scene.releaseId !== input.releaseId) errors.push(`scene ${scene.id} belongs to another release`);
  }

  const evidenceIds = new Set();
  const assetIds = new Set();
  for (const entry of input.evidencePackage?.entries ?? []) {
    const refKey = evidenceRefKey(entry.ref);
    if (evidenceIds.has(refKey)) errors.push(`duplicate evidence ref: ${refKey}`);
    if (assetIds.has(entry.assetVersionId)) errors.push(`duplicate asset version id: ${entry.assetVersionId}`);
    evidenceIds.add(refKey);
    assetIds.add(entry.assetVersionId);
    if (entry.ref?.assetVersionId !== entry.assetVersionId) errors.push(`evidence ${refKey} assetVersionId mismatch`);
    for (const key of ownerKeys) if (entry[key] !== input[key]) errors.push(`evidence ${refKey}.${key} must equal input.${key}`);
    for (const sceneId of entry.sceneIds ?? []) if (!sceneIds.has(sceneId)) errors.push(`evidence ${refKey} references unknown scene ${sceneId}`);
    try {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(entry.contentBase64) || entry.contentBase64.length % 4 !== 0) throw new Error("invalid base64");
      const bytes = Buffer.from(entry.contentBase64, "base64");
      if (bytes.length !== entry.bytes) errors.push(`evidence ${refKey} byte count does not match content`);
      if (sha256(bytes) !== entry.sha256) errors.push(`evidence ${refKey} sha256 does not match content`);
    } catch {
      errors.push(`evidence ${refKey} has invalid base64 content`);
    }
  }
  const packageRefs = new Set((input.evidencePackage?.refs ?? []).map(evidenceRefKey));
  for (const key of evidenceIds) if (!packageRefs.has(key)) errors.push(`materialized evidence ${key} is not frozen in EvidencePackageVersion`);
  for (const scene of input.storyboard?.scenes ?? []) {
    if (scene.claimType === "browser_behavior" && !(scene.evidence ?? []).some((ref) => ref.kind === "node_evidence")) {
      errors.push(`browser behavior scene ${scene.id} requires NodeEvidence`);
    }
    for (const ref of scene.evidence ?? []) if (!packageRefs.has(evidenceRefKey(ref))) errors.push(`scene ${scene.id} references evidence outside EvidencePackageVersion`);
  }
  if (input.evidencePackage?.captureRunId !== input.captureRunId) errors.push("evidencePackage.captureRunId must equal input.captureRunId");
  if (input.evidencePackage?.provenance?.flowVersionId !== input.productFlowVersionId) errors.push("evidencePackage.provenance.flowVersionId must equal input.productFlowVersionId");
  if (input.evidencePackage?.entries && evidencePackageDigest(input.evidencePackage.entries) !== input.evidencePackage.sha256) errors.push("evidencePackage.sha256 does not match its locked entry manifest");
  return errors;
}

export function planErrors(plan, input) {
  const errors = [];
  const beats = plan.beats ?? [];
  let cursor = 0;
  const beatIds = new Set();
  for (const beat of beats) {
    if (beatIds.has(beat.id)) errors.push(`duplicate beat id: ${beat.id}`);
    beatIds.add(beat.id);
    if (beat.startMs !== cursor) errors.push(`beat ${beat.id} must start at ${cursor}ms`);
    cursor = beat.startMs + beat.durationMs;
    for (const rectName of ["crop", "focus"]) {
      for (const use of beat.evidence ?? []) {
        const rect = use[rectName];
        if (rect && (rect.x + rect.width > 1 || rect.y + rect.height > 1)) errors.push(`beat ${beat.id} ${rectName} must stay inside normalized bounds`);
      }
    }
    for (const use of beat.evidence ?? []) {
      if (use.trim && use.trim.outMs <= use.trim.inMs) errors.push(`beat ${beat.id} trim.outMs must be greater than trim.inMs`);
    }
    for (const value of [beat.headline, beat.body]) {
      if (typeof value === "string" && (/<\/?[a-z][^>]*>/i.test(value) || /https?:\/\//i.test(value) || /```|javascript:/i.test(value))) errors.push(`beat ${beat.id} copy contains prohibited code, markup, or URL content`);
    }
  }
  if (cursor !== plan.durationMs) errors.push(`timeline ends at ${cursor}ms, expected ${plan.durationMs}ms`);
  if (!input) return errors;

  for (const key of ["releaseId", "storyboardVersionId", "evidencePackageVersionId", "brandKitVersionId", "templateVersion", "locale"]) if (plan[key] !== input[key]) errors.push(`plan.${key} must equal input.${key}`);
  if (plan.durationMs !== input.targetDurationMs) errors.push("plan.durationMs must equal input.targetDurationMs");
  const scenes = new Map(input.storyboard.scenes.map((scene) => [scene.id, scene]));
  const evidence = new Map(input.evidencePackage.entries.map((entry) => [evidenceRefKey(entry.ref), entry]));
  const allowed = {
    layoutId: new Set(input.templateCapabilities.layoutIds),
    motionPresetId: new Set(input.templateCapabilities.motionPresetIds),
    transitionId: new Set(input.templateCapabilities.transitionIds)
  };
  for (const beat of beats) {
    const scene = scenes.get(beat.sceneId);
    if (!scene) errors.push(`beat ${beat.id} references unknown scene ${beat.sceneId}`);
    if (scene && beat.capabilityId !== scene.capabilityId) errors.push(`beat ${beat.id} capability ${beat.capabilityId} does not match scene ${scene.id}`);
    for (const field of ["layoutId", "motionPresetId", "transitionId"]) if (!allowed[field].has(beat[field])) errors.push(`beat ${beat.id} uses illegal ${field} ${beat[field]}`);
    if ((beat.headline?.length ?? 0) > input.templateCapabilities.copyLimits.headlineMaxChars) errors.push(`beat ${beat.id} headline exceeds copy limit`);
    if ((beat.body?.length ?? 0) > input.templateCapabilities.copyLimits.bodyMaxChars) errors.push(`beat ${beat.id} body exceeds copy limit`);
    for (const use of beat.evidence ?? []) {
      const refKey = evidenceRefKey(use);
      const entry = evidence.get(refKey);
      if (!entry) errors.push(`beat ${beat.id} references missing or mismatched evidence ${refKey}`);
      else if (!entry.sceneIds.includes(beat.sceneId)) errors.push(`evidence ${refKey} is not approved for scene ${beat.sceneId}`);
    }
    if (scene?.claimType !== "non_factual" && !(beat.evidence?.length > 0)) errors.push(`factual scene ${scene.id} requires evidence`);
  }
  return errors;
}

export function printResult(errors) {
  if (errors.length) {
    process.stderr.write(`${errors.map((error) => `ERROR: ${error}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("valid\n");
  }
}
