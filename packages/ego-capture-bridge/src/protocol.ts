import { z } from "zod";
import { LocatorV1Schema, type LocatorV1 } from "@purpleink/product-flow";

export const locatorV1Schema = LocatorV1Schema;
export type { LocatorV1 };

export const evidenceEntryV1Schema = z
  .object({
    nodeId: z.string().min(1).max(256),
    actionId: z.string().min(1).max(256).optional(),
    kind: z.enum([
      "before_screenshot",
      "result_screenshot",
      "node_clip",
      "assertion_report",
      "dom_summary",
      "trace",
      "diagnostic",
    ]),
    r2Key: z.string().min(1).max(1_024),
    mimeType: z.string().regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i),
    bytes: z.number().int().positive().max(500 * 1024 * 1024),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    redactionStatus: z.enum(["passed", "blocked", "needs_review"]),
  })
  .strict();

export const evidenceManifestV1Schema = z
  .object({
    schemaVersion: z.literal("evidence-manifest/v1"),
    captureSessionId: z.string().uuid(),
    runId: z.string().uuid(),
    flowVersionId: z.string().uuid(),
    entries: z.array(evidenceEntryV1Schema).min(1).max(1_000),
  })
  .strict();

export type EvidenceEntryV1 = z.infer<typeof evidenceEntryV1Schema>;
export type EvidenceManifestV1 = z.infer<typeof evidenceManifestV1Schema>;

export type CaptureEffect =
  | "read"
  | "idempotent_write"
  | "non_idempotent_write";

export type CaptureAction = {
  id: string;
  kind: "navigate" | "click" | "fill" | "select" | "keypress" | "wait_for";
  effect: CaptureEffect;
  target?: LocatorV1;
  url?: string;
  value?: string;
};

export type CapturePlan = {
  sessionId: string;
  allowedOrigins: string[];
  actions: CaptureAction[];
};

export type CaptureEvent = {
  seq: number;
  type: "session_started" | "action_completed" | "user_action_required" | "session_completed";
  actionId?: string;
};
