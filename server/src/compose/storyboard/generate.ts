// LLM storyboard generation: produces a structured JSON storyboard
// describing every shot in the brand video.
import { callStepMessages } from "../../lib/step-client"
import { logger } from "../../lib/logger"
import { buildStoryboardPrompt } from "./prompts"
import type { Storyboard } from "./types"
import type { ComposeContext } from "../chapters/types"
import type { VideoModel } from "../model"
import type { FrameSpec } from "../design-system/types"

// ---------------------------------------------------------------------------
// Narrative Arc definitions (Phase 3)
// ---------------------------------------------------------------------------

export interface NarrativeArc {
  beats: string[]
  description: string
}

export const NARRATIVE_ARCS: Record<string, NarrativeArc> = {
  'PAS': { beats: ['hook', 'pain', 'agitation', 'solution_tease', 'product_intro', 'proof', 'cta'], description: '痛点已知且紧迫：hook → pain → agitation → solution → product → proof → CTA' },
  'Future_Pacing': { beats: ['imagine', 'product_intro', 'remove_pain', 'mechanism', 'outcome', 'cta'], description: '推销新未来：imagine → product → remove pain → mechanism → outcome → CTA' },
  'Demo_Loop': { beats: ['question', 'product_intro', 'demo_1', 'demo_2', 'trust', 'cta'], description: 'UI 自解释：question → product → demo cycle → trust → CTA' },
  'BAB': { beats: ['before', 'after_tease', 'bridge', 'step_1', 'step_2', 'wow', 'cta'], description: '桥接旧→新：before → after → bridge → steps → wow → CTA' },
  'Feature_Benefit': { beats: ['category_hook', 'feature_1', 'benefit_1', 'feature_2', 'benefit_2', 'climax', 'cta'], description: '功能丰富：hook → feature → benefit → feature → benefit → climax → CTA' },
}

/**
 * Deterministic narrative arc selection based on keyword matching
 * from brand title, tagline, description, and page content signals.
 * No LLM subjective judgment — pure keyword → arc mapping.
 */
export function selectNarrativeArc(ctx: ComposeContext, model: VideoModel): { arcId: string; arc: NarrativeArc } {
  // Build a combined signal string from all brand/content sources
  const signals = [
    model.name || '',
    model.brand?.title || '',
    model.brand?.tagline || '',
    ctx.brand?.title || '',
    ctx.brand?.tagline || '',
    ctx.brand?.description || '',
    ctx.copy?.headline || '',
    ctx.copy?.subheadline || '',
    ...ctx.copy?.features?.map(f => `${f.title} ${f.desc}`) || [],
    ...ctx.hero?.chips || [],
  ].join(' ').toLowerCase()

  // Demo Loop: AI/ML/dev tool/platform keywords
  if (/\b(ai|ml|model|agent|api|dev|code|tool|platform|saas)\b/.test(signals)) {
    return { arcId: 'Demo_Loop', arc: NARRATIVE_ARCS['Demo_Loop']! }
  }
  // PAS: pain/problem keywords
  if (/\b(pain|problem|slow|manual|hard|difficult)\b/.test(signals)) {
    return { arcId: 'PAS', arc: NARRATIVE_ARCS['PAS']! }
  }
  // Future Pacing: future/innovation keywords
  if (/\b(new|future|revolution|transform|next|innovate)\b/.test(signals)) {
    return { arcId: 'Future_Pacing', arc: NARRATIVE_ARCS['Future_Pacing']! }
  }
  // BAB: workflow/migration keywords
  if (/\b(workflow|process|automate|replace|migrate)\b/.test(signals)) {
    return { arcId: 'BAB', arc: NARRATIVE_ARCS['BAB']! }
  }
  // Default: Feature-Benefit Cascade (also when feature/benefit/powerful/complete detected)
  return { arcId: 'Feature_Benefit', arc: NARRATIVE_ARCS['Feature_Benefit']! }
}

/**
 * Generate a storyboard via LLM.
 * Sends brand context + content to the model, asks for a JSON storyboard
 * with 8-12 shots including narration per shot.
 *
 * @param ctx - Compose context with brand/copy data
 * @param model - Video model
 * @param frameSpec - Optional FrameSpec from design-system (Phase A) to inject
 *   composition rules into the prompt.
 */
export async function generateStoryboard(
  ctx: ComposeContext,
  model: VideoModel,
  frameSpec?: FrameSpec,
): Promise<Storyboard> {
  // Phase 3: Select narrative arc deterministically
  const { arcId, arc } = selectNarrativeArc(ctx, model)

  const systemPrompt = `You are a professional video director. Output ONLY valid JSON. No markdown, no code fences, no explanation.`
  const userPrompt = buildStoryboardPrompt(ctx, model, frameSpec, arcId, arc)

  logger.info("storyboard:generating", {
    brand: ctx.brand.title,
    duration: ctx.durationSec,
    skin: ctx.skin.id,
    promptLen: userPrompt.length,
    hasFrameSpec: !!frameSpec,
    narrativeArc: arcId,
    arcBeats: arc.beats,
    requestBodyBytes: JSON.stringify({ system: systemPrompt, messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }] }).length,
  })

  const response = await callStepMessages({
    system: systemPrompt,
    content: [{ type: "text", text: userPrompt }],
    maxTokens: 8000,
  })

  logger.info("storyboard:response", { responseLen: response?.length || 0 })

  // Parse JSON (handle possible markdown code fence)
  let jsonStr = response
    .replace(/^```(?:json|JSON)?\s*\n?/gm, "")
    .replace(/```\s*$/gm, "")
    .trim()

  const parsed = JSON.parse(jsonStr) as Storyboard

  // Normalize new fields: ensure defaults for backward compatibility
  if (parsed.shots) {
    for (const shot of parsed.shots) {
      // Default transition_in to "cut" if not provided
      if (!shot.transition_in) {
        shot.transition_in = "cut"
      }
      // Default status to "outline" if not provided
      if (!shot.status) {
        shot.status = "outline"
      }
      // Default voiceover to narration if not provided
      if (!shot.voiceover && shot.narration) {
        shot.voiceover = shot.narration
      }
    }
  }

  return parsed
}
