import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareNarrationAssets } from "../server/src/tts/orchestrate";
import type { VideoModel } from "../server/src/compose/model";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

describe("TTS orchestration", () => {
  it("writes independent narration artifacts without returning a visual model", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "purpleink-tts-"));
    created.push(projectDir);
    const model = makeModel();
    const config = {
      TTS_PROVIDER: "listenhub-flowspeech" as const,
      LISTENHUB_API_KEY: "test-key-never-persist",
      LISTENHUB_API_BASE_URL: "https://api.marswave.ai/openapi",
      LISTENHUB_TTS_ENDPOINT: "/v1/tts" as const,
      LISTENHUB_TTS_VOICE: "nanzhongyin-4897116a",
      LISTENHUB_TTS_RESPONSE_FORMAT: "mp3" as const,
    };
    const buildTrack = vi.fn(async (_paths, _durations, outputPath: string) => {
      await writeFile(outputPath, new Uint8Array());
    });

    const result = await prepareNarrationAssets(model, projectDir, config, {
      generatePlan: async () => ({
        locale: "zh-CN",
        segments: [
          { sceneIndex: 0, text: "独立旁白一。" },
          { sceneIndex: 1, text: "独立旁白二。" },
        ],
      }),
      synthesize: async (text) => new TextEncoder().encode(text).buffer,
      measureDuration: async (path) => (path.endsWith("000.mp3") ? 4 : 2),
      buildTrack,
    });

    expect(result).not.toHaveProperty("model");
    expect(result.narrationPath).toBe(
      join(projectDir, "audio", "narration.wav")
    );
    expect(buildTrack).toHaveBeenCalledWith(
      [
        join(projectDir, "audio", "segments", "000.mp3"),
        join(projectDir, "audio", "segments", "001.mp3"),
      ],
      [3, 4],
      result.narrationPath,
      expect.objectContaining({
        leadInSec: 0.25,
        tailHoldSec: 0.5,
        audioDurations: [4, 2],
      })
    );

    const plan = JSON.parse(
      await readFile(join(projectDir, "narration-plan.json"), "utf8")
    );
    expect(plan.segments[0]!.text).toBe("独立旁白一。");
    const metaText = await readFile(
      join(projectDir, "audio_meta.json"),
      "utf8"
    );
    expect(metaText).not.toContain("test-key-never-persist");
    expect(JSON.parse(metaText)).toMatchObject({
      provider: "listenhub-flowspeech",
      voice: "nanzhongyin-4897116a",
      responseFormat: "mp3",
      totalDurationSec: 7,
    });
  });
});

function makeModel(): VideoModel {
  return {
    id: "demo",
    name: "Demo",
    brand: { title: "PurpleInk", tagline: "Tagline" },
    hero: { headline: "Headline", lede: "Lede", ctas: [], chips: [] },
    valueProps: [],
    logos: [],
    pricing: [],
    cta: { headline: "CTA", command: "go" },
    palette: {
      fg: "#111111",
      bg: "#ffffff",
      accent: "#ff0000",
      accentFg: "#ffffff",
      muted: "#555555",
      secondary: "#eeeeee",
      border: "#dddddd",
      fontFamily: "Inter",
    },
    skin: {
      id: "editorial",
      minShot: 2,
      maxShots: 8,
      motion: { enter: "power2.out", transition: "crossfade" },
    },
    scenes: [
      { kind: "brand-center", start: 0, duration: 3 },
      {
        kind: "shot-window",
        start: 3,
        duration: 4,
        shots: [{ src: "assets/a.png", caption: "visual only", tall: false }],
      },
    ],
    durationSec: 7,
  };
}
