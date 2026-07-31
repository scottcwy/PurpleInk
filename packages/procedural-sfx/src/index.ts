export const PROCEDURAL_SFX_GENERATOR_VERSION = "procedural-sfx/1.0.0";

export const PROCEDURAL_SFX_PRESETS = [
  "tick",
  "whoosh",
  "impact",
  "ping",
] as const;

export type ProceduralSfxPreset = (typeof PROCEDURAL_SFX_PRESETS)[number];
export const PROCEDURAL_SFX_MODES = ["off", "procedural"] as const;
export type ProceduralSfxMode = (typeof PROCEDURAL_SFX_MODES)[number];

export interface ProceduralSfxCue {
  preset: ProceduralSfxPreset;
  atFrame: number;
  gainDb: number;
}

export interface ProceduralSfxPlan {
  generatorVersion: typeof PROCEDURAL_SFX_GENERATOR_VERSION;
  fps: number;
  totalFrames: number;
  cues: ProceduralSfxCue[];
  timingHash: string;
  cuePlanHash: string;
}

export type ProceduralSfxStatus =
  | "applied"
  | "omitted-off"
  | "omitted-no-cues"
  | "omitted-unsupported"
  | "omitted-error";

export interface ProceduralSfxResultContract {
  mode: ProceduralSfxMode;
  status: ProceduralSfxStatus;
  generatorVersion: typeof PROCEDURAL_SFX_GENERATOR_VERSION;
  cueCount: number;
  timingHash: string | null;
  cuePlanHash: string | null;
  waveformHashes: string[];
  failureCode?: "PROCEDURAL_SFX_MIX_FAILED";
}

/** Manifest 与浏览器响应共用的 fail-closed 跨字段语义。 */
export function isProceduralSfxResultContract(
  value: unknown
): value is ProceduralSfxResultContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (
    !PROCEDURAL_SFX_MODES.includes(raw.mode as ProceduralSfxMode) ||
    !isStatus(raw.status) ||
    raw.generatorVersion !== PROCEDURAL_SFX_GENERATOR_VERSION ||
    !isNonNegativeInteger(raw.cueCount) ||
    !isHashOrNull(raw.timingHash) ||
    !isHashOrNull(raw.cuePlanHash) ||
    !Array.isArray(raw.waveformHashes) ||
    !raw.waveformHashes.every(isHash)
  ) {
    return false;
  }
  const noFailure = raw.failureCode === undefined;
  if (raw.status === "applied") {
    return (
      raw.mode === "procedural" &&
      raw.cueCount > 0 &&
      isHash(raw.timingHash) &&
      isHash(raw.cuePlanHash) &&
      raw.waveformHashes.length === raw.cueCount &&
      noFailure
    );
  }
  if (raw.status === "omitted-off") {
    return raw.mode === "off" && emptyResult(raw) && noFailure;
  }
  if (raw.status === "omitted-no-cues") {
    return (
      raw.mode === "procedural" &&
      raw.cueCount === 0 &&
      isHash(raw.timingHash) &&
      isHash(raw.cuePlanHash) &&
      raw.waveformHashes.length === 0 &&
      noFailure
    );
  }
  if (raw.status === "omitted-unsupported") {
    return raw.mode === "procedural" && emptyResult(raw) && noFailure;
  }
  return (
    raw.mode === "procedural" &&
    raw.failureCode === "PROCEDURAL_SFX_MIX_FAILED" &&
    hashesArePaired(raw) &&
    raw.waveformHashes.length <= raw.cueCount
  );
}

function isStatus(value: unknown): value is ProceduralSfxStatus {
  return typeof value === "string" && [
    "applied",
    "omitted-off",
    "omitted-no-cues",
    "omitted-unsupported",
    "omitted-error",
  ].includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isHashOrNull(value: unknown): value is string | null {
  return value === null || isHash(value);
}

function emptyResult(raw: Record<string, unknown>): boolean {
  return (
    raw.cueCount === 0 &&
    raw.timingHash === null &&
    raw.cuePlanHash === null &&
    Array.isArray(raw.waveformHashes) &&
    raw.waveformHashes.length === 0
  );
}

function hashesArePaired(raw: Record<string, unknown>): boolean {
  return (
    (raw.timingHash === null && raw.cuePlanHash === null) ||
    (isHash(raw.timingHash) && isHash(raw.cuePlanHash))
  );
}

export { buildBoundaryCuePlan, type BoundaryCuePlanInput } from "./plan";
export {
  readWavInfo,
  synthesizeProceduralWav,
  type ProceduralWavInfo,
  type SynthesizeProceduralWavInput,
} from "./wav";
