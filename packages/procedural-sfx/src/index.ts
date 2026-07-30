export const PROCEDURAL_SFX_GENERATOR_VERSION = "procedural-sfx/1.0.0";

export const PROCEDURAL_SFX_PRESETS = [
  "tick",
  "whoosh",
  "impact",
  "ping",
] as const;

export type ProceduralSfxPreset = (typeof PROCEDURAL_SFX_PRESETS)[number];

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

export { buildBoundaryCuePlan, type BoundaryCuePlanInput } from "./plan";
export {
  readWavInfo,
  synthesizeProceduralWav,
  type ProceduralWavInfo,
  type SynthesizeProceduralWavInput,
} from "./wav";
