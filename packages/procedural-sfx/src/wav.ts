import type { ProceduralSfxPreset } from "./index";
import { seedFromString } from "./hash";

export interface SynthesizeProceduralWavInput {
  preset: ProceduralSfxPreset;
  seed: string;
}

export interface ProceduralWavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  sampleCount: number;
  durationMs: number;
}

const SAMPLE_RATE = 48_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const HEADER_BYTES = 44;
const DURATION_MS: Record<ProceduralSfxPreset, number> = {
  tick: 90,
  ping: 180,
  impact: 240,
  whoosh: 320,
};

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function envelope(
  progress: number,
  attackSeconds: number,
  duration: number
): number {
  const attack = Math.min(1, (progress * duration) / attackSeconds);
  return attack * Math.pow(1 - progress, 3);
}

function synthesizeSample(
  preset: ProceduralSfxPreset,
  progress: number,
  duration: number,
  noise: number,
  filteredNoise: number
): number {
  const seconds = progress * duration;
  switch (preset) {
    case "tick":
      return (
        (Math.sin(2 * Math.PI * (2_200 - 700 * progress) * seconds) * 0.75 +
          noise * 0.08) *
        envelope(progress, 0.002, duration) *
        Math.pow(1 - progress, 5)
      );
    case "ping":
      return (
        (Math.sin(2 * Math.PI * 880 * seconds) * 0.66 +
          Math.sin(2 * Math.PI * 1_760 * seconds) * 0.2 +
          noise * 0.015) *
        envelope(progress, 0.006, duration) *
        Math.exp(-3 * progress)
      );
    case "impact":
      return (
        (Math.sin(2 * Math.PI * (110 - 55 * progress) * seconds) * 0.72 +
          filteredNoise * 0.34) *
        envelope(progress, 0.004, duration) *
        Math.exp(-2.5 * progress)
      );
    case "whoosh":
      return (
        (filteredNoise * 0.72 +
          Math.sin(2 * Math.PI * (180 + 720 * progress) * seconds) * 0.12) *
        Math.pow(Math.sin(Math.PI * progress), 0.8)
      );
  }
}

function createWavBuffer(sampleCount: number): {
  bytes: Uint8Array;
  view: DataView;
} {
  const dataBytes = sampleCount * 2;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * 2, true);
  view.setUint16(32, CHANNELS * 2, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return { bytes, view };
}

export function synthesizeProceduralWav(
  input: SynthesizeProceduralWavInput
): Uint8Array {
  if (
    typeof input.preset !== "string" ||
    !Object.hasOwn(DURATION_MS, input.preset) ||
    typeof input.seed !== "string"
  ) {
    throw new TypeError(
      "preset and seed must match the procedural SFX contract"
    );
  }
  const durationMs = DURATION_MS[input.preset];
  const duration = durationMs / 1_000;
  const sampleCount = Math.round(SAMPLE_RATE * duration);
  const { bytes, view } = createWavBuffer(sampleCount);
  const random = createRandom(seedFromString(`${input.preset}:${input.seed}`));
  let filteredNoise = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / sampleCount;
    const noise = random() * 2 - 1;
    const smoothing = 0.025 + progress * 0.2;
    filteredNoise += (noise - filteredNoise) * smoothing;
    const raw = synthesizeSample(
      input.preset,
      progress,
      duration,
      noise,
      filteredNoise
    );
    const clamped = Math.max(-1, Math.min(1, raw * 0.85));
    view.setInt16(HEADER_BYTES + index * 2, Math.round(clamped * 32_767), true);
  }
  return bytes;
}

function readAscii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index))
  ).join("");
}

export function readWavInfo(bytes: Uint8Array): ProceduralWavInfo {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new TypeError("WAV bytes are shorter than the canonical header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataBytes = view.getUint32(40, true);
  const canonical =
    readAscii(view, 0, 4) === "RIFF" &&
    readAscii(view, 8, 4) === "WAVE" &&
    readAscii(view, 12, 4) === "fmt " &&
    readAscii(view, 36, 4) === "data" &&
    view.getUint32(4, true) === bytes.byteLength - 8 &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === CHANNELS &&
    view.getUint32(24, true) === SAMPLE_RATE &&
    view.getUint32(28, true) === SAMPLE_RATE * CHANNELS * 2 &&
    view.getUint16(32, true) === CHANNELS * 2 &&
    view.getUint16(34, true) === BITS_PER_SAMPLE &&
    dataBytes === bytes.byteLength - HEADER_BYTES &&
    dataBytes % 2 === 0;
  if (!canonical) {
    throw new TypeError("WAV bytes do not match the procedural SFX contract");
  }
  const sampleCount = dataBytes / 2;
  return {
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    sampleCount,
    durationMs: (sampleCount / SAMPLE_RATE) * 1_000,
  };
}
