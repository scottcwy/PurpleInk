import type { VideoModel } from "../compose/model";
import { callStepMessages } from "../lib/step-client";

export interface NarrationSegment {
  sceneIndex: number;
  text: string;
}

export interface NarrationPlan {
  locale: string;
  segments: NarrationSegment[];
}

interface NarrationCallOptions {
  system: string;
  content: Array<{ type: "text"; text: string }>;
  maxTokens: number;
  model: string;
}

type NarrationCaller = (options: NarrationCallOptions) => Promise<string>;

export function buildNarrationPrompt(model: VideoModel): string {
  const input = {
    name: model.name,
    brand: model.brand,
    hero: model.hero,
    valueProps: model.valueProps,
    logos: model.logos,
    pricing: model.pricing,
    cta: model.cta,
    scenes: model.scenes.map((scene, sceneIndex) => ({
      sceneIndex,
      kind: scene.kind,
      targetDurationSec: scene.duration,
      ...(scene.stats ? { stats: scene.stats } : {}),
    })),
  };

  return [
    "为产品视频撰写独立的中文旁白稿。",
    "每个视觉场景必须且只能对应一段旁白，sceneIndex 必须与输入一致。",
    "每段旁白必须简洁，并能在对应 targetDurationSec 内自然读完。",
    "旁白应自然连贯，使用品牌、产品价值、统计与行动号召信息，不要描述截图或字幕。",
    '只返回 JSON：{"locale":"zh-CN","segments":[{"sceneIndex":0,"text":"..."}]}。',
    JSON.stringify(input, null, 2),
  ].join("\n\n");
}

export async function generateNarrationPlan(
  model: VideoModel,
  call: NarrationCaller = callStepMessages
): Promise<NarrationPlan> {
  const response = await call({
    system: "你是产品视频旁白编剧。旁白必须独立于画面字幕，严格返回 JSON。",
    content: [{ type: "text", text: buildNarrationPrompt(model) }],
    maxTokens: 3000,
    model: "step-explore",
  });
  return parseNarrationPlan(response, model.scenes.length);
}

export function parseNarrationPlan(
  raw: string,
  sceneCount: number
): NarrationPlan {
  let value: unknown;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    value = JSON.parse(
      start >= 0 && end >= start ? raw.slice(start, end + 1) : raw
    );
  } catch {
    throw new Error("Narration plan must be valid JSON");
  }

  if (
    !isRecord(value) ||
    typeof value.locale !== "string" ||
    !Array.isArray(value.segments)
  ) {
    throw new Error("Narration plan has an invalid shape");
  }

  const segments = value.segments.map((segment) => {
    if (
      !isRecord(segment) ||
      !Number.isInteger(segment.sceneIndex) ||
      typeof segment.text !== "string" ||
      segment.text.trim().length === 0
    ) {
      throw new Error("Narration plan contains an invalid segment");
    }
    return {
      sceneIndex: segment.sceneIndex as number,
      text: segment.text.trim(),
    };
  });

  const indexes = segments
    .map((segment) => segment.sceneIndex)
    .sort((a, b) => a - b);
  const expectedIndexes = Array.from(
    { length: sceneCount },
    (_, index) => index
  );
  if (
    indexes.length !== sceneCount ||
    indexes.some((index, position) => index !== expectedIndexes[position])
  ) {
    throw new Error(
      "Narration plan must cover every visual scene exactly once"
    );
  }

  return {
    locale: value.locale,
    segments: [...segments].sort((a, b) => a.sceneIndex - b.sceneIndex),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
