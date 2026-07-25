import { describe, expect, it } from "vitest";

import {
  buildNarrationPrompt,
  generateNarrationPlan,
  parseNarrationPlan,
} from "../server/src/tts/narration";
import type { VideoModel } from "../server/src/compose/model";

const model = {
  id: "demo",
  name: "Demo",
  brand: { title: "PurpleInk", tagline: "Turn products into stories" },
  hero: {
    headline: "Ship a product video",
    lede: "Capture real product workflows and explain them clearly.",
    ctas: ["Start creating"],
    chips: ["Capture", "Compose"],
  },
  valueProps: [
    { title: "Real workflows", desc: "Uses captured product evidence." },
  ],
  logos: [],
  pricing: [],
  cta: { headline: "Start creating.", command: "purple.ink" },
  palette: {
    fg: "#111111",
    bg: "#ffffff",
    accent: "#ff3366",
    accentFg: "#ffffff",
    muted: "#595959",
    secondary: "#f5f5f5",
    border: "#dddddd",
    fontFamily: "Inter",
  },
  skin: {
    id: "editorial",
    minShot: 2.2,
    maxShots: 8,
    motion: { enter: "power2.out", transition: "crossfade" },
  },
  scenes: [
    { kind: "brand-center", start: 0, duration: 3 },
    {
      kind: "shot-window",
      start: 3,
      duration: 4,
      shots: [
        {
          src: "assets/product.png",
          caption: "DO NOT USE THIS VISUAL CAPTION",
          tall: false,
        },
      ],
    },
  ],
  durationSec: 7,
} satisfies VideoModel;

describe("TTS narration planning", () => {
  it("builds narration input without visual captions", () => {
    const prompt = buildNarrationPrompt(model);

    expect(prompt).toContain('"sceneIndex": 0');
    expect(prompt).toContain('"sceneIndex": 1');
    expect(prompt).toContain('"targetDurationSec": 3');
    expect(prompt).toContain('"targetDurationSec": 4');
    expect(prompt).not.toContain("DO NOT USE THIS VISUAL CAPTION");
    expect(prompt).not.toContain("product.png");
  });

  it("accepts exactly one narration segment per visual scene", () => {
    const plan = parseNarrationPlan(
      JSON.stringify({
        locale: "zh-CN",
        segments: [
          { sceneIndex: 0, text: "先认识 PurpleInk。" },
          { sceneIndex: 1, text: "再看看真实的产品工作流。" },
        ],
      }),
      model.scenes.length
    );

    expect(plan.segments.map((segment) => segment.sceneIndex)).toEqual([0, 1]);
  });

  it("rejects narration that does not cover every visual scene", () => {
    expect(() =>
      parseNarrationPlan(
        JSON.stringify({
          locale: "zh-CN",
          segments: [{ sceneIndex: 0, text: "只有一段。" }],
        }),
        model.scenes.length
      )
    ).toThrow(/every visual scene/i);
  });

  it("generates and validates narration through the text model", async () => {
    const call = async (options: {
      content: Array<{ type: string; text?: string }>;
    }) => {
      expect(options.content[0]?.text).not.toContain(
        "DO NOT USE THIS VISUAL CAPTION"
      );
      return JSON.stringify({
        locale: "zh-CN",
        segments: [
          { sceneIndex: 0, text: "先认识 PurpleInk。" },
          { sceneIndex: 1, text: "再看看产品如何帮助创作。" },
        ],
      });
    };

    await expect(generateNarrationPlan(model, call)).resolves.toEqual({
      locale: "zh-CN",
      segments: [
        { sceneIndex: 0, text: "先认识 PurpleInk。" },
        { sceneIndex: 1, text: "再看看产品如何帮助创作。" },
      ],
    });
  });
});
