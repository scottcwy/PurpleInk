import { describe, expect, it, vi } from "vitest";

import {
  buildNarrationTrack,
  measureAudioDuration,
  muxNarration,
  type ProcessRunner,
} from "../server/src/tts/media";

describe("TTS media commands", () => {
  it("reads duration using ffprobe machine output", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: "2.375\n",
      stderr: "",
    }));

    await expect(measureAudioDuration("segment.mp3", runner)).resolves.toBe(
      2.375
    );
    expect(runner).toHaveBeenCalledWith("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "segment.mp3",
    ]);
  });

  it("muxes narration after visual rendering without re-encoding video", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));

    await muxNarration("visual.mp4", "narration.wav", "final.mp4", runner);

    expect(runner).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([
        "-i",
        "visual.mp4",
        "-i",
        "narration.wav",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "final.mp4",
      ])
    );
  });

  it("builds one narration track aligned to fixed visual scenes", async () => {
    const runner: ProcessRunner = vi.fn(async () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }));

    await buildNarrationTrack(
      ["scene-0.mp3", "scene-1.mp3"],
      [3, 4],
      "narration.wav",
      {
        leadInSec: 0.25,
        tailHoldSec: 0.5,
        audioDurations: [4, 2],
        runner,
      }
    );

    const [command, args] = vi.mocked(runner).mock.calls[0]!;
    expect(command).toBe("ffmpeg");
    expect(args).toEqual(
      expect.arrayContaining([
        "-i",
        "scene-0.mp3",
        "-i",
        "scene-1.mp3",
        "-filter_complex",
        expect.stringContaining("amix=inputs=3:duration=longest"),
        "narration.wav",
      ])
    );
    expect(args.join(" ")).toContain("adelay=250:all=1");
    expect(args.join(" ")).toContain("adelay=3250:all=1");
    expect(args.join(" ")).toContain("atempo=1.7778");
    expect(args.join(" ")).toContain("atrim=duration=2.25");
    expect(args).toEqual(
      expect.arrayContaining([
        "-f",
        "lavfi",
        "-t",
        "7",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      ])
    );
    expect(args).toEqual(expect.arrayContaining(["-t", "7"]));
  });
});
