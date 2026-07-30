import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { VideoModel } from "../compose/model";
import type { TtsEnv } from "../../../src/lib/tts/config";
import {
  generateNarrationPlan,
  parseNarrationPlan,
  type NarrationPlan,
} from "./narration";
import { synthesizeFlowSpeech } from "./listenhub";
import { buildNarrationTrack, measureAudioDuration } from "./media";
import { synthesizeMimoSpeech } from "./mimo";

export interface NarrationAssets {
  plan: NarrationPlan;
  narrationPath: string;
}

const NARRATION_LEAD_IN_SEC = 0.25;
const NARRATION_TAIL_HOLD_SEC = 0.5;

interface NarrationDependencies {
  generatePlan?: (model: VideoModel) => Promise<NarrationPlan>;
  synthesize?: (text: string, config: TtsEnv) => Promise<ArrayBuffer>;
  measureDuration?: (path: string) => Promise<number>;
  buildTrack?: typeof buildNarrationTrack;
  onPhase?: (phase: "scripting" | "synthesizing" | "timing") => void;
}

export async function prepareNarrationAssets(
  model: VideoModel,
  projectDir: string,
  config: TtsEnv,
  dependencies: NarrationDependencies = {}
): Promise<NarrationAssets> {
  const generatePlan = dependencies.generatePlan ?? generateNarrationPlan;
  const synthesize = dependencies.synthesize ?? synthesizeConfiguredSpeech;
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
  for (const segment of plan.segments) {
    const filename = `${String(segment.sceneIndex).padStart(3, "0")}.${responseFormat(config)}`;
    const path = join(segmentsDir, filename);
    const audio = await synthesize(segment.text, config);
    await writeFile(path, Buffer.from(audio));
    segmentPaths.push(path);
  }

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
    provider: config.TTS_PROVIDER,
    voice: voice(config),
    responseFormat: responseFormat(config),
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

function synthesizeConfiguredSpeech(
  text: string,
  config: TtsEnv
): Promise<ArrayBuffer> {
  return config.TTS_PROVIDER === "mimo"
    ? synthesizeMimoSpeech(text, config)
    : synthesizeFlowSpeech(text, config);
}

function responseFormat(config: TtsEnv): string {
  return config.TTS_PROVIDER === "mimo"
    ? "wav"
    : config.LISTENHUB_TTS_RESPONSE_FORMAT;
}

function voice(config: TtsEnv): string {
  return config.TTS_PROVIDER === "mimo"
    ? config.MIMO_TTS_VOICE
    : config.LISTENHUB_TTS_VOICE;
}
