import { z } from "zod";

const uuid = z.uuid();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const imageDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const nodeEvidenceRefV1Schema = z.object({
  kind: z.literal("node_evidence"),
  nodeEvidenceId: uuid,
  assetVersionId: uuid,
}).strict();

export const sourceAssetRefV1Schema = z.object({
  kind: z.literal("source_asset"),
  sourceAssetId: uuid,
  assetVersionId: uuid,
}).strict();

export const evidenceRefV1Schema = z.discriminatedUnion("kind", [
  nodeEvidenceRefV1Schema,
  sourceAssetRefV1Schema,
]);

export const evidencePackageV1Schema = z.object({
  schemaVersion: z.literal("evidence-package/v1"),
  releaseId: uuid,
  captureRunId: uuid,
  refs: z.array(evidenceRefV1Schema).min(1),
  provenance: z.object({
    flowVersionId: uuid,
    manifestHash: sha256,
    workerImageDigest: imageDigest,
  }).strict(),
}).strict().superRefine((payload, context) => {
  const keys = payload.refs.map((ref) =>
    ref.kind === "node_evidence"
      ? `node_evidence:${ref.nodeEvidenceId}`
      : `source_asset:${ref.sourceAssetId}:${ref.assetVersionId}`
  );
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "EvidenceRef entries must be unique", path: ["refs"] });
  }
});

export const storyboardV1Schema = z.object({
  schemaVersion: z.literal("storyboard/v1"),
  releaseId: uuid,
  evidencePackageVersionId: uuid,
  scenes: z.array(z.object({
    id: uuid,
    order: z.int().min(1),
    capabilityId: uuid,
    claimType: z.enum(["browser_behavior", "static_media", "non_factual"]),
    headline: z.string().trim().min(1).max(120),
    body: z.string().trim().max(240),
    evidence: z.array(evidenceRefV1Schema),
  }).strict().superRefine((scene, context) => {
    if (scene.claimType !== "non_factual" && scene.evidence.length === 0) {
      context.addIssue({ code: "custom", message: "factual Scene requires approved EvidenceRef", path: ["evidence"] });
    }
    if (
      scene.claimType === "browser_behavior" &&
      !scene.evidence.some((ref) => ref.kind === "node_evidence")
    ) {
      context.addIssue({ code: "custom", message: "browser behavior requires NodeEvidence", path: ["evidence"] });
    }
  })).min(3).max(5),
}).strict().superRefine((storyboard, context) => {
  const ids = storyboard.scenes.map(({ id }) => id);
  const orders = storyboard.scenes.map(({ order }) => order);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Scene IDs must be unique", path: ["scenes"] });
  }
  if (
    new Set(orders).size !== orders.length ||
    [...orders].sort((a, b) => a - b).some((order, index) => order !== index + 1)
  ) {
    context.addIssue({ code: "custom", message: "Scene order must be contiguous from 1", path: ["scenes"] });
  }
});

export type EvidenceRefV1 = z.infer<typeof evidenceRefV1Schema>;
export type EvidencePackageV1 = z.infer<typeof evidencePackageV1Schema>;
export type StoryboardV1 = z.infer<typeof storyboardV1Schema>;

export function parseEvidencePackageV1(value: unknown): EvidencePackageV1 {
  return evidencePackageV1Schema.parse(value);
}

export function parseStoryboardV1(value: unknown): StoryboardV1 {
  return storyboardV1Schema.parse(value);
}
