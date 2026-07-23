import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const skillRoot = fileURLToPath(new URL("..", import.meta.url));

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function validateSchema(value, schemaName) {
  const schema = await readJson(`${skillRoot}/schemas/${schemaName}`);
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

export function evidencePackageDigest(entries) {
  const lockedEntries = entries.map(({ contentBase64: _content, ...entry }) => entry).sort((a, b) => a.nodeEvidenceId.localeCompare(b.nodeEvidenceId));
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
  if (input.evidencePackage?.id !== input.evidencePackageId) errors.push("evidencePackage.id must equal evidencePackageId");
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
    if (evidenceIds.has(entry.nodeEvidenceId)) errors.push(`duplicate evidence id: ${entry.nodeEvidenceId}`);
    if (assetIds.has(entry.assetVersionId)) errors.push(`duplicate asset version id: ${entry.assetVersionId}`);
    evidenceIds.add(entry.nodeEvidenceId);
    assetIds.add(entry.assetVersionId);
    for (const key of ownerKeys) if (entry[key] !== input[key]) errors.push(`evidence ${entry.nodeEvidenceId}.${key} must equal input.${key}`);
    for (const sceneId of entry.sceneIds ?? []) if (!sceneIds.has(sceneId)) errors.push(`evidence ${entry.nodeEvidenceId} references unknown scene ${sceneId}`);
    try {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(entry.contentBase64) || entry.contentBase64.length % 4 !== 0) throw new Error("invalid base64");
      const bytes = Buffer.from(entry.contentBase64, "base64");
      if (bytes.length !== entry.bytes) errors.push(`evidence ${entry.nodeEvidenceId} byte count does not match content`);
      if (sha256(bytes) !== entry.sha256) errors.push(`evidence ${entry.nodeEvidenceId} sha256 does not match content`);
    } catch {
      errors.push(`evidence ${entry.nodeEvidenceId} has invalid base64 content`);
    }
  }
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
      for (const reference of beat.evidence ?? []) {
        const rect = reference[rectName];
        if (rect && (rect.x + rect.width > 1 || rect.y + rect.height > 1)) errors.push(`beat ${beat.id} ${rectName} must stay inside normalized bounds`);
      }
    }
    for (const reference of beat.evidence ?? []) {
      if (reference.trim && reference.trim.outMs <= reference.trim.inMs) errors.push(`beat ${beat.id} trim.outMs must be greater than trim.inMs`);
    }
    for (const value of [beat.headline, beat.body]) {
      if (typeof value === "string" && (/<\/?[a-z][^>]*>/i.test(value) || /https?:\/\//i.test(value) || /```|javascript:/i.test(value))) errors.push(`beat ${beat.id} copy contains prohibited code, markup, or URL content`);
    }
  }
  if (cursor !== plan.durationMs) errors.push(`timeline ends at ${cursor}ms, expected ${plan.durationMs}ms`);
  if (!input) return errors;

  for (const key of ["releaseId", "storyboardVersionId", "brandKitVersionId", "templateVersion"]) if (plan[key] !== input[key]) errors.push(`plan.${key} must equal input.${key}`);
  if (plan.durationMs !== input.targetDurationMs) errors.push("plan.durationMs must equal input.targetDurationMs");
  const scenes = new Map(input.storyboard.scenes.map((scene) => [scene.id, scene]));
  const evidence = new Map(input.evidencePackage.entries.map((entry) => [`${entry.nodeEvidenceId}:${entry.assetVersionId}`, entry]));
  const allowed = {
    capabilityIds: new Set(input.templateCapabilities.capabilityIds),
    layoutId: new Set(input.templateCapabilities.layoutIds),
    motionPresetId: new Set(input.templateCapabilities.motionPresetIds),
    transitionId: new Set(input.templateCapabilities.transitionIds)
  };
  for (const beat of beats) {
    const scene = scenes.get(beat.sceneId);
    if (!scene) errors.push(`beat ${beat.id} references unknown scene ${beat.sceneId}`);
    for (const id of beat.capabilityIds ?? []) {
      if (!allowed.capabilityIds.has(id)) errors.push(`beat ${beat.id} uses unapproved capability ${id}`);
      if (scene && !scene.capabilityIds.includes(id)) errors.push(`beat ${beat.id} capability ${id} is not in scene ${scene.id}`);
    }
    for (const field of ["layoutId", "motionPresetId", "transitionId"]) if (!allowed[field].has(beat[field])) errors.push(`beat ${beat.id} uses illegal ${field} ${beat[field]}`);
    if ((beat.headline?.length ?? 0) > input.templateCapabilities.copyLimits.headlineMaxChars) errors.push(`beat ${beat.id} headline exceeds copy limit`);
    if ((beat.body?.length ?? 0) > input.templateCapabilities.copyLimits.bodyMaxChars) errors.push(`beat ${beat.id} body exceeds copy limit`);
    for (const reference of beat.evidence ?? []) {
      const entry = evidence.get(`${reference.nodeEvidenceId}:${reference.assetVersionId}`);
      if (!entry) errors.push(`beat ${beat.id} references missing or mismatched evidence ${reference.nodeEvidenceId}/${reference.assetVersionId}`);
      else if (!entry.sceneIds.includes(beat.sceneId)) errors.push(`evidence ${entry.nodeEvidenceId} is not approved for scene ${beat.sceneId}`);
    }
    if (scene?.factual && !(beat.evidence?.length > 0)) errors.push(`factual scene ${scene.id} requires evidence`);
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
