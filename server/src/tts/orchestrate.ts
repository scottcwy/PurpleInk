import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { VideoModel } from "../compose/model";
import {
  synthesizeWorkerSpeech,
  type WorkerTtsResult,
} from "../ai/gateway-client";
import {
  generateNarrationPlan,
  parseNarrationPlan,
  type NarrationPlan,
} from "./narration";
import { buildNarrationTrack, measureAudioDuration } from "./media";

export interface NarrationAssets {
  plan: NarrationPlan;
  narrationPath: string;
}

const NARRATION_LEAD_IN_SEC = 0.25;
const NARRATION_TAIL_HOLD_SEC = 0.5;

interface NarrationDependencies {
  generatePlan?: (model: VideoModel) => Promise<NarrationPlan>;
  synthesize?: (text: string) => Promise<WorkerTtsResult>;
  measureDuration?: (path: string) => Promise<number>;
  buildTrack?: typeof buildNarrationTrack;
  onPhase?: (phase: "scripting" | "synthesizing" | "timing") => void;
}

export async function prepareNarrationAssets(
  model: VideoModel,
  projectDir: string,
  dependencies: NarrationDependencies = {}
): Promise<NarrationAssets> {
  const generatePlan = dependencies.generatePlan ?? generateNarrationPlan;
  const synthesize = dependencies.synthesize ?? synthesizeWorkerSpeech;
  const measureDuration = dependencies.measureDuration ?? measureAudioDuration;
  const buildTrack = dependencies.buildTrack ?? buildNarrationTrack;
  const audioDir = join(projectDir, "audio");
  const segmentsDir = join(audioDir, "segments");
  await mkdir(segmentsDir, { recursive: true });

  dependencies.onPhase?.("scripting");
  const generatedPlan = await generatePlan(model);
  const plan = parseNarrationPlan(
    JSON.stringify(generatedPlan),
    model.scenes.length
  );
  await writeFile(
    join(projectDir, "narration-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8"
  );

  dependencies.onPhase?.("synthesizing");
  const segmentPaths: string[] = [];
  let responseFormat: WorkerTtsResult["audioFormat"] | undefined;
  for (const segment of plan.segments) {
    const synthesized = await synthesize(segment.text);
    responseFormat ??= synthesized.audioFormat;
    if (synthesized.audioFormat !== responseFormat) {
      throw new Error("WORKER_TTS_FORMAT_CHANGED");
    }
    const filename = `${String(segment.sceneIndex).padStart(3, "0")}.${responseFormat}`;
    const path = join(segmentsDir, filename);
    await writeFile(path, Buffer.from(synthesized.audio));
    segmentPaths.push(path);
  }
  if (!responseFormat) throw new Error("WORKER_TTS_EMPTY_PLAN");

  dependencies.onPhase?.("timing");
  const audioDurations = await Promise.all(
    segmentPaths.map((path) => measureDuration(path))
  );
  const narrationPath = join(audioDir, "narration.wav");
  const sceneDurations = model.scenes.map((scene) => scene.duration);
  await buildTrack(segmentPaths, sceneDurations, narrationPath, {
    leadInSec: NARRATION_LEAD_IN_SEC,
    tailHoldSec: NARRATION_TAIL_HOLD_SEC,
    audioDurations,
  });

  const metadata = {
    provider: "purpleink-ai-gateway",
    voice: "workspace-route",
    responseFormat,
    totalDurationSec: model.durationSec,
    narrationPath: relative(projectDir, narrationPath),
    segments: plan.segments.map((segment, index) => ({
      sceneIndex: segment.sceneIndex,
      text: segment.text,
      audioPath: relative(projectDir, segmentPaths[index]!),
      audioDurationSec: audioDurations[index]!,
      sceneStartSec: model.scenes[index]!.start,
      sceneDurationSec: model.scenes[index]!.duration,
    })),
  };
  await writeFile(
    join(projectDir, "audio_meta.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );

  return { plan, narrationPath };
}
