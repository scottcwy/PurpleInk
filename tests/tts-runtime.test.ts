import { describe, expect, it, vi } from "vitest";

import { synthesizeFlowSpeech } from "../server/src/tts/listenhub";
import {
  buildNarrationTrack,
  measureAudioDuration,
  muxNarration,
  type ProcessRunner,
} from "../server/src/tts/media";

const ttsConfig = {
  TTS_PROVIDER: "listenhub-flowspeech" as const,
  LISTENHUB_API_KEY: "test-key",
  LISTENHUB_API_BASE_URL: "https://api.marswave.ai/openapi",
  LISTENHUB_TTS_ENDPOINT: "/v1/tts" as const,
  LISTENHUB_TTS_VOICE: "nanzhongyin-4897116a",
  LISTENHUB_TTS_RESPONSE_FORMAT: "mp3" as const,
};

describe("FlowSpeech client", () => {
  it("sends the documented request without a model field", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        })
    );

    const audio = await synthesizeFlowSpeech(
      "独立旁白。",
      ttsConfig,
      fetchImpl
    );

    expect(new Uint8Array(audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.marswave.ai/openapi/v1/tts");
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      input: "独立旁白。",
      voice: "nanzhongyin-4897116a",
      response_format: "mp3",
    });
    expect(String(init?.body)).not.toContain("model");
  });

  it("does not include the API response body in errors", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response("upstream secret detail", { status: 401 })
    );

    await expect(
      synthesizeFlowSpeech("旁白。", ttsConfig, fetchImpl)
    ).rejects.toThrow("FlowSpeech TTS failed with status 401");
    await expect(
      synthesizeFlowSpeech("旁白。", ttsConfig, fetchImpl)
    ).rejects.not.toThrow("upstream secret detail");
  });
});

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
