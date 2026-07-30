import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyWebsiteProceduralSfx,
  type WebsiteProceduralSfxInput,
} from "../server/src/compose/procedural-sfx";
import { runProcess } from "../server/src/tts/media";

describe("website procedural sound effects", () => {
  let workDirectory = "";

  beforeEach(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), "purpleink-website-sfx-"));
  });

  afterEach(async () => {
    await rm(workDirectory, { recursive: true, force: true });
  });

  it("keeps the existing narrated MP4 byte path untouched when disabled", async () => {
    const runner = vi.fn();
    const baseInput = input(workDirectory);

    const result = await applyWebsiteProceduralSfx(
      { ...baseInput, mode: "off" },
      runner
    );

    expect(result.videoPath).toBe(baseInput.narratedVideoPath);
    expect(result.soundEffects).toMatchObject({
      mode: "off",
      status: "omitted-off",
      cueCount: 0,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("materializes deterministic WAV cues and mixes them into one final MP4", async () => {
    const baseInput = input(workDirectory);
    const waveforms: Buffer[] = [];
    const runner = vi.fn(async (_command: string, args: string[]) => {
      const wavPaths = args.filter((argument) => argument.endsWith(".wav"));
      for (const path of wavPaths) waveforms.push(await readFile(path));
      return { code: 0, stdout: "", stderr: "" };
    });

    const result = await applyWebsiteProceduralSfx(baseInput, runner);

    expect(result.videoPath).toBe(
      join(workDirectory, "website-narrated-sfx.mp4")
    );
    expect(result.soundEffects).toMatchObject({
      mode: "procedural",
      status: "applied",
      cueCount: 3,
      generatorVersion: "procedural-sfx/1.0.0",
      timingHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      cuePlanHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      waveformHashes: [
        expect.stringMatching(/^[a-f0-9]{64}$/),
        expect.stringMatching(/^[a-f0-9]{64}$/),
        expect.stringMatching(/^[a-f0-9]{64}$/),
      ],
    });
    expect(waveforms).toHaveLength(3);
    expect(
      waveforms.every(
        (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF"
      )
    ).toBe(true);
  });

  it("falls back to the narrated MP4 and records only a safe code when mixing fails", async () => {
    const baseInput = input(workDirectory);
    const result = await applyWebsiteProceduralSfx(
      baseInput,
      vi.fn(async () => ({ code: 1, stdout: "", stderr: "private path" }))
    );

    expect(result.videoPath).toBe(baseInput.narratedVideoPath);
    expect(result.soundEffects).toMatchObject({
      mode: "procedural",
      status: "omitted-error",
      cueCount: 3,
      failureCode: "PROCEDURAL_SFX_MIX_FAILED",
    });
    expect(JSON.stringify(result.soundEffects)).not.toContain("private path");
  });

  it("produces a decodable MP4 with real ffmpeg bytes", async () => {
    if (!ffmpegPath) throw new Error("ffmpeg-static is unavailable");
    const executable = ffmpegPath;
    const baseInput = input(workDirectory);
    const generated = await runProcess(executable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x111827:s=320x180:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=220:sample_rate=48000",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      baseInput.narratedVideoPath,
    ]);
    expect(generated.code).toBe(0);

    const result = await applyWebsiteProceduralSfx(
      {
        ...baseInput,
        totalFrames: 60,
        boundaries: [0, 30],
      },
      (_command, args) => runProcess(executable, args)
    );
    const bytes = await readFile(result.videoPath);
    const probe = await runProcess(executable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      result.videoPath,
      "-f",
      "null",
      "-",
    ]);

    expect(result.soundEffects.status).toBe("applied");
    expect((await stat(result.videoPath)).size).toBe(bytes.byteLength);
    expect(bytes.includes(Buffer.from("ftyp"))).toBe(true);
    expect(probe.code).toBe(0);
  }, 30_000);
});

function input(workDirectory: string): WebsiteProceduralSfxInput {
  return {
    mode: "procedural",
    fps: 30,
    totalFrames: 180,
    boundaries: [0, 60, 120],
    narratedVideoPath: join(workDirectory, "website-narrated.mp4"),
    workDirectory,
  };
}
