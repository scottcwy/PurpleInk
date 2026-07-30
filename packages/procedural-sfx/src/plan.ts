import {
  PROCEDURAL_SFX_GENERATOR_VERSION,
  type ProceduralSfxCue,
  type ProceduralSfxPlan,
} from "./index";
import { sha256Hex } from "./hash";

export interface BoundaryCuePlanInput {
  fps: number;
  totalFrames: number;
  boundaries: readonly number[];
}

const MINIMUM_GAP_SECONDS = 0.25;
const INTRO_OFFSET_SECONDS = 0.3;
const MAXIMUM_CUES = 24;
const CUE_PALETTE = [
  { preset: "ping", gainDb: -24 },
  { preset: "whoosh", gainDb: -24 },
  { preset: "tick", gainDb: -26 },
  { preset: "impact", gainDb: -24 },
] as const satisfies readonly Pick<ProceduralSfxCue, "preset" | "gainDb">[];

function assertTimeline(input: BoundaryCuePlanInput): void {
  if (!Number.isFinite(input.fps) || input.fps <= 0) {
    throw new RangeError("fps must be a positive finite number");
  }
  if (!Number.isInteger(input.totalFrames) || input.totalFrames <= 0) {
    throw new RangeError("totalFrames must be a positive integer");
  }
}

function normalizeBoundaries(input: BoundaryCuePlanInput): number[] {
  return [...new Set(input.boundaries)]
    .filter(
      (frame) =>
        Number.isInteger(frame) && frame >= 0 && frame < input.totalFrames
    )
    .sort((left, right) => left - right);
}

function selectCueFrames(
  boundaries: readonly number[],
  fps: number,
  totalFrames: number
): number[] {
  const minimumGap = Math.ceil(fps * MINIMUM_GAP_SECONDS);
  const introFrame = Math.min(
    totalFrames - 1,
    Math.round(fps * INTRO_OFFSET_SECONDS)
  );
  const selected: number[] = [];

  for (const boundary of boundaries) {
    const frame = boundary === 0 ? introFrame : boundary;
    const previous = selected.at(-1);
    if (previous === undefined || frame - previous >= minimumGap) {
      selected.push(frame);
    }
    if (selected.length === MAXIMUM_CUES) {
      break;
    }
  }
  return selected;
}

export function buildBoundaryCuePlan(
  input: BoundaryCuePlanInput
): ProceduralSfxPlan {
  assertTimeline(input);
  const boundaries = normalizeBoundaries(input);
  const cueFrames = selectCueFrames(boundaries, input.fps, input.totalFrames);
  const cues = cueFrames.map((atFrame, index) => ({
    ...CUE_PALETTE[index % CUE_PALETTE.length]!,
    atFrame,
  }));
  const timingHash = sha256Hex(
    JSON.stringify({
      fps: input.fps,
      totalFrames: input.totalFrames,
      boundaries,
    })
  );
  const cuePlanHash = sha256Hex(
    JSON.stringify({
      generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
      fps: input.fps,
      totalFrames: input.totalFrames,
      cues,
      timingHash,
    })
  );

  return {
    generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
    fps: input.fps,
    totalFrames: input.totalFrames,
    cues,
    timingHash,
    cuePlanHash,
  };
}
