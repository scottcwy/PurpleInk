import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  buildBoundaryCuePlan,
  PROCEDURAL_SFX_GENERATOR_VERSION,
  synthesizeProceduralWav,
  type ProceduralSfxMode,
  type ProceduralSfxStatus,
} from "@purpleink/procedural-sfx";
import { runProcess, type ProcessRunner } from "../tts/media";

export interface WebsiteProceduralSfxResult {
  mode: ProceduralSfxMode;
  status: ProceduralSfxStatus;
  generatorVersion: typeof PROCEDURAL_SFX_GENERATOR_VERSION;
  cueCount: number;
  timingHash: string | null;
  cuePlanHash: string | null;
  waveformHashes: string[];
  failureCode?: "PROCEDURAL_SFX_MIX_FAILED";
}

export interface WebsiteProceduralSfxInput {
  mode: ProceduralSfxMode;
  fps: number;
  totalFrames: number;
  boundaries: readonly number[];
  narratedVideoPath: string;
  workDirectory: string;
}

export async function applyWebsiteProceduralSfx(
  input: WebsiteProceduralSfxInput,
  runner: ProcessRunner = runProcess
): Promise<{ videoPath: string; soundEffects: WebsiteProceduralSfxResult }> {
  if (input.mode === "off") {
    return {
      videoPath: input.narratedVideoPath,
      soundEffects: omitted("off", "omitted-off"),
    };
  }

  let cueDirectory: string | null = null;
  let outputPath: string | null = null;
  let failureResult = omittedError();
  try {
    const plan = buildBoundaryCuePlan({
      fps: input.fps,
      totalFrames: input.totalFrames,
      boundaries: input.boundaries,
    });
    const base: Pick<
      WebsiteProceduralSfxResult,
      "mode" | "generatorVersion" | "cueCount" | "timingHash" | "cuePlanHash"
    > = {
      mode: "procedural",
      generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
      cueCount: plan.cues.length,
      timingHash: plan.timingHash,
      cuePlanHash: plan.cuePlanHash,
    };
    failureResult = {
      ...base,
      status: "omitted-error",
      waveformHashes: [],
      failureCode: "PROCEDURAL_SFX_MIX_FAILED",
    };
    if (plan.cues.length === 0) {
      return {
        videoPath: input.narratedVideoPath,
        soundEffects: {
          ...base,
          status: "omitted-no-cues",
          waveformHashes: [],
        },
      };
    }

    const createdCueDirectory = await mkdtemp(
      join(input.workDirectory, ".procedural-sfx-")
    );
    cueDirectory = createdCueDirectory;
    const extension = extname(input.narratedVideoPath) || ".mp4";
    const mixedOutputPath = join(
      dirname(input.narratedVideoPath),
      `${basename(input.narratedVideoPath, extension)}-sfx${extension}`
    );
    outputPath = mixedOutputPath;
    const waveforms = await Promise.all(
      plan.cues.map(async (cue, index) => {
        const bytes = synthesizeProceduralWav({
          preset: cue.preset,
          seed: `${plan.cuePlanHash}:${index}:${cue.preset}`,
        });
        const path = join(
          createdCueDirectory,
          `cue-${String(index).padStart(2, "0")}-${cue.preset}.wav`
        );
        await writeFile(path, bytes);
        return {
          path,
          atFrame: cue.atFrame,
          gainDb: cue.gainDb,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
        };
      })
    );
    const result = await runner(
      "ffmpeg",
      buildMixArguments(input, waveforms, mixedOutputPath)
    );
    if (result.code !== 0) throw new Error("WEBSITE_PROCEDURAL_SFX_MIX_FAILED");
    return {
      videoPath: mixedOutputPath,
      soundEffects: {
        ...base,
        status: "applied",
        waveformHashes: waveforms.map((waveform) => waveform.contentHash),
      },
    };
  } catch {
    if (outputPath) {
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
    return {
      videoPath: input.narratedVideoPath,
      soundEffects: failureResult,
    };
  } finally {
    if (cueDirectory) {
      await rm(cueDirectory, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }
}

function buildMixArguments(
  input: WebsiteProceduralSfxInput,
  waveforms: readonly { path: string; atFrame: number; gainDb: number }[],
  outputPath: string
): string[] {
  const filters = [
    "[0:a:0]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[base]",
  ];
  for (const [index, waveform] of waveforms.entries()) {
    const delayMs = Math.round((waveform.atFrame / input.fps) * 1_000);
    filters.push(
      `[${index + 1}:a:0]aresample=48000,` +
        "aformat=sample_rates=48000:channel_layouts=stereo," +
        `volume=${waveform.gainDb}dB,adelay=${delayMs}|${delayMs}[sfx${index}]`
    );
  }
  const labels = waveforms.map((_, index) => `[sfx${index}]`).join("");
  filters.push(
    waveforms.length === 1
      ? `${labels}anull[sfxbus]`
      : `${labels}amix=inputs=${waveforms.length}:duration=longest:normalize=0[sfxbus]`,
    "[base][sfxbus]amix=inputs=2:duration=first:normalize=0," +
      "alimiter=limit=0.891251[audio]"
  );
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    input.narratedVideoPath,
    ...waveforms.flatMap((waveform) => ["-i", waveform.path]),
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[audio]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

function omitted(
  mode: ProceduralSfxMode,
  status: ProceduralSfxStatus
): WebsiteProceduralSfxResult {
  return {
    mode,
    status,
    generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
    cueCount: 0,
    timingHash: null,
    cuePlanHash: null,
    waveformHashes: [],
  };
}

function omittedError(): WebsiteProceduralSfxResult {
  return {
    ...omitted("procedural", "omitted-error"),
    failureCode: "PROCEDURAL_SFX_MIX_FAILED",
  };
}

export function websiteProceduralSfxNotRun(
  mode: ProceduralSfxMode
): WebsiteProceduralSfxResult {
  return omitted(mode, mode === "off" ? "omitted-off" : "omitted-unsupported");
}
