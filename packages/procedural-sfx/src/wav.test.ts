import { describe, expect, it } from "vitest";

import {
  readWavInfo,
  synthesizeProceduralWav,
  type ProceduralSfxPreset,
  type SynthesizeProceduralWavInput,
} from "./index";

const EXPECTED_DURATIONS_MS: Record<ProceduralSfxPreset, number> = {
  tick: 90,
  ping: 180,
  impact: 240,
  whoosh: 320,
};

describe("synthesizeProceduralWav", () => {
  it("returns identical bytes for the same preset and seed", () => {
    const first = synthesizeProceduralWav({ preset: "whoosh", seed: "abc" });
    const second = synthesizeProceduralWav({ preset: "whoosh", seed: "abc" });

    expect(first).toEqual(second);
    expect(Buffer.from(first).subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("changes stochastic waveform bytes when the seed changes", () => {
    const first = synthesizeProceduralWav({ preset: "impact", seed: "abc" });
    const second = synthesizeProceduralWav({ preset: "impact", seed: "def" });

    expect(first).not.toEqual(second);
  });

  it.each(Object.entries(EXPECTED_DURATIONS_MS))(
    "writes canonical 48 kHz mono PCM s16 bytes for %s",
    (preset, durationMs) => {
      const bytes = synthesizeProceduralWav({
        preset: preset as ProceduralSfxPreset,
        seed: "format-contract",
      });

      expect(readWavInfo(bytes)).toEqual({
        sampleRate: 48_000,
        channels: 1,
        bitsPerSample: 16,
        sampleCount: Math.round((48_000 * durationMs) / 1_000),
        durationMs,
      });
      expect(bytes.byteLength).toBe(
        44 + Math.round((48_000 * durationMs) / 1_000) * 2
      );
    }
  );

  it("keeps generated samples bounded and non-silent", () => {
    const bytes = synthesizeProceduralWav({ preset: "ping", seed: "bounded" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = Array.from(
      { length: (bytes.byteLength - 44) / 2 },
      (_, index) => view.getInt16(44 + index * 2, true)
    );

    expect(
      Math.max(...samples.map((sample) => Math.abs(sample)))
    ).toBeLessThanOrEqual(32_767);
    expect(samples.some((sample) => sample !== 0)).toBe(true);
  });

  it("rejects bytes that are not the package WAV contract", () => {
    expect(() => readWavInfo(new Uint8Array(44))).toThrow(TypeError);
  });

  it("rejects preset names outside the fixed palette at runtime", () => {
    const invalid = {
      preset: "toString",
      seed: "invalid-preset",
    } as unknown as SynthesizeProceduralWavInput;

    expect(() => synthesizeProceduralWav(invalid)).toThrow(TypeError);
  });
});
