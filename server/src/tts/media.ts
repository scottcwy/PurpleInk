import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: string[]
) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

export async function measureAudioDuration(
  audioPath: string,
  runner: ProcessRunner = runProcess
): Promise<number> {
  const result = await runner("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  const duration = Number(result.stdout.trim());
  if (result.code !== 0 || !Number.isFinite(duration) || duration < 0) {
    throw new Error(
      `Unable to measure audio duration (ffprobe exit ${result.code})`
    );
  }
  return duration;
}

export interface BuildNarrationTrackOptions {
  leadInSec: number;
  tailHoldSec: number;
  audioDurations: number[];
  runner?: ProcessRunner;
}

export async function buildNarrationTrack(
  segmentPaths: string[],
  sceneDurations: number[],
  outputPath: string,
  options: BuildNarrationTrackOptions
): Promise<void> {
  if (
    segmentPaths.length === 0 ||
    segmentPaths.length !== sceneDurations.length ||
    segmentPaths.length !== options.audioDurations.length
  ) {
    throw new Error("Narration segments must match scene durations");
  }

  const inputArgs = segmentPaths.flatMap((path) => ["-i", path]);
  let sceneStartSec = 0;
  const filters = segmentPaths.map((_, index) => {
    const sceneDuration = sceneDurations[index]!;
    const availableDuration =
      sceneDuration - options.leadInSec - options.tailHoldSec;
    if (availableDuration <= 0) {
      throw new Error(`Scene ${index} has no room for narration`);
    }
    const audioDuration = options.audioDurations[index]!;
    const tempo = buildTempoFilters(audioDuration / availableDuration);
    const delayMs = Math.round((sceneStartSec + options.leadInSec) * 1000);
    sceneStartSec += sceneDuration;
    return [
      `[${index}:a]aresample=48000`,
      "aformat=sample_fmts=s16:channel_layouts=stereo",
      ...tempo,
      `atrim=duration=${availableDuration}`,
      "asetpts=N/SR/TB",
      `adelay=${delayMs}:all=1[a${index}]`,
    ].join(",");
  });

  const runner = options.runner ?? runProcess;
  const totalDuration = sceneDurations.reduce(
    (sum, duration) => sum + duration,
    0
  );
  const silenceInputIndex = segmentPaths.length;
  const mixInputs = [
    `[${silenceInputIndex}:a]`,
    ...segmentPaths.map((_, index) => `[a${index}]`),
  ].join("");
  filters.push(
    `${mixInputs}amix=inputs=${segmentPaths.length + 1}:duration=longest:dropout_transition=0:normalize=0,` +
      `atrim=duration=${totalDuration},asetpts=N/SR/TB[out]`
  );
  const result = await runner("ffmpeg", [
    "-y",
    ...inputArgs,
    "-f",
    "lavfi",
    "-t",
    String(totalDuration),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    "-t",
    String(totalDuration),
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(
      `Unable to build narration track (ffmpeg exit ${result.code})`
    );
  }
}

function buildTempoFilters(ratio: number): string[] {
  if (!Number.isFinite(ratio) || ratio <= 1) return [];
  const filters: string[] = [];
  let remaining = ratio;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  if (remaining > 1.0001) {
    filters.push(`atempo=${Math.round(remaining * 10_000) / 10_000}`);
  }
  return filters;
}

export async function muxNarration(
  videoPath: string,
  narrationPath: string,
  outputPath: string,
  runner: ProcessRunner = runProcess
): Promise<void> {
  const result = await runner("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-i",
    narrationPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(`Unable to mux narration (ffmpeg exit ${result.code})`);
  }
}
