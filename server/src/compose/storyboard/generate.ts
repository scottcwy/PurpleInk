// LLM storyboard generation: produces a structured JSON storyboard
// describing every shot in the brand video.
import { callStepMessages } from "../../lib/step-client"
import { logger } from "../../lib/logger"
import { buildStoryboardPrompt } from "./prompts"
import type { Storyboard } from "./types"
import type { ComposeContext } from "../chapters/types"
import type { VideoModel } from "../model"

/**
 * Generate a storyboard via LLM.
 * Sends brand context + content to the model, asks for a JSON storyboard
 * with 8-12 shots including narration per shot.
 */
export async function generateStoryboard(ctx: ComposeContext, model: VideoModel): Promise<Storyboard> {
  const systemPrompt = `You are a professional video director. Output ONLY valid JSON. No markdown, no code fences, no explanation.`
  const userPrompt = buildStoryboardPrompt(ctx, model)

  logger.info("storyboard:generating", {
    brand: ctx.brand.title,
    duration: ctx.durationSec,
    skin: ctx.skin.id,
    promptLen: userPrompt.length,
  })

  const response = await callStepMessages({
    system: systemPrompt,
    content: [{ type: "text", text: userPrompt }],
    maxTokens: 4000,
  })

  logger.info("storyboard:response", { responseLen: response?.length || 0 })

  // Parse JSON (handle possible markdown code fence)
  let jsonStr = response
    .replace(/^```(?:json|JSON)?\s*\n?/gm, "")
    .replace(/```\s*$/gm, "")
    .trim()

  const parsed = JSON.parse(jsonStr) as Storyboard
  return parsed
}
