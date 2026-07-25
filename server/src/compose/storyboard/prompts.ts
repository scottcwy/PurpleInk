// Storyboard prompt: asks LLM to produce a structured JSON storyboard.
import type { ComposeContext } from "../chapters/types"
import type { VideoModel, ShotType } from "../model"
import type { FrameSpec } from "../design-system/types"
import type { NarrativeArc } from "./generate"
import { AUTHENTICITY_RULE, NO_MARKDOWN_SUFFIX, PALETTE_VARS } from "../shared-prompt-rules"

/**
 * Build the user prompt for storyboard generation.
 * Compressed to minimize token usage with step-3.7-flash reasoning model.
 */
export function buildStoryboardPrompt(
  ctx: ComposeContext,
  _model: VideoModel,
  frameSpec?: FrameSpec,
  narrativeArcId?: string,
  narrativeArc?: NarrativeArc,
): string {
  const features = ctx.copy.features.map((f) => `- ${f.title}: ${f.desc}`).join("\n")
  const stats = ctx.copy.stats.map((s) => `- ${s.value} ${s.label}`).join("\n")
  const screenshots = ctx.screenshots
    .map((s, i) => `- [${i + 1}] ${s.caption} (${s.path})`)
    .join("\n")
  const logos = ctx.logos.length > 0 ? `\nLogos: ${ctx.logos.join(", ")}` : ""
  const pricing = ctx.pricing.length > 0
    ? `\nPricing:\n${ctx.pricing.map((p) => `- ${p.name}: ${p.price}`).join("\n")}`
    : ""

  const assetPaths = ctx.screenshots.map((s) => s.path)
  const assetCandidatesBlock = assetPaths.length > 0
    ? assetPaths.map((p) => `    - "${p}"`).join("\n")
    : "    (no screenshot assets)"

  const frameSpecBlock = frameSpec
    ? `\n## Frame Constraints\nPreset: "${frameSpec.preset.name}"\n${frameSpec.preset.compositionRules.map((r) => `- ${r}`).join("\n")}\n`
    : ""

  return `Design a storyboard JSON for a brand product video.

## Brand
"${ctx.brand.title}" — "${ctx.brand.tagline}"
Tone: ${ctx.tone} | Skin: ${ctx.skin.id} | Font: ${ctx.fontFamily} | Duration: ${ctx.durationSec}s

## Palette
${PALETTE_VARS.map(([k, label]) => `- ${k}: ${(ctx.palette as Record<string, string>)[k] ?? (ctx.palette as Record<string, string>)[k.replace('-', '')]} (${label})`).join("\n")}

## Content
Headline: "${ctx.copy.headline}"
Sub: "${ctx.copy.subheadline}"
CTAs: ${ctx.copy.ctas.join(", ")}
${features ? `\nFeatures:\n${features}` : ""}${stats ? `\nStats:\n${stats}` : ""}
${screenshots}${logos}${pricing}
CTA: "${ctx.cta.headline}" / "${ctx.cta.command}"
${frameSpecBlock}
## Shot Types
brand-center, brand-side, hero-split, hero-stack, shot-window, shot-tilt, shot-zoom, shot-split, feature-row, feature-stack, data-counter, chips-marquee, logo-wall, pricing, cta-push, cta-fullbleed

## Transitions
cut, crossfade, blur-crossfade, push-slide, zoom-through, squeeze

## Blueprint Selection (choose per shot)
### Hook shots: kinetic-type-beats, typewriter-reveal, cursor-ui-demo, dataviz-countup
### Problem shots: overwhelm-surround, broken-flow-interrupt
### Product_Intro shots: logo-assemble-lockup, ticker-takeover, kinetic-type-beats, cursor-ui-demo
### Showcase shots: device-surface-showcase, camera-journey, coordinate-target-zoom
### Proof shots: grid-card-assemble, dataviz-countup, constellation-hub, comparison-split
### CTA shots: cta-morph-press, titlecard-reveal

## Asset Candidates
${assetCandidatesBlock}

## Rules
1. 8-12 shots, total duration = ${ctx.durationSec}s, sequential startTime (no gaps/overlaps), min 2s each
2. First shot: brand-center/brand-side. Last shot: cta-push/cta-fullbleed
3. Vary shot types (no consecutive repeats)
4. Each shot needs: id, type, chapter, startTime, duration, visualDescription, narration (≤18 words), voiceover (≤18 words), transition_in, transition
5. Chapters: ch1-opening, ch2-hero, ch3-showcase, ch4-proof, ch5-cta
6. ${AUTHENTICITY_RULE}
7. Screenshot shots: include asset_candidates from list above
8. Prefer "${ctx.skin.motion.transition}" transition, others OK for variety
9. Video elements allowed (autoplay muted loop playsinline, src from assets/)
10. Optional fields: focal, sfx, poster, screenText, layers, roles, status, src, assets
11. Include "globals": { format, message, arc, audience }

## Output JSON Schema
{
  "meta": { "brand", "tagline", "tone", "totalDuration", "skin", "fontFamily", "palette": { ... } },
  "globals": { "format": "1920x1080", "message", "arc", "audience" },
  "shots": [{
    "id": "shot-01",
    "type": "<ShotType>",
    "chapter": "<ChapterId>",
    "startTime": 0,
    "duration": 3,
    "visualDescription": "...",
    "screenText": { "headline"?, "subheadline"?, "eyebrow"?, "labels"?, "data"?, "command"? },
    "narration": "≤18 words",
    "transition": "<type>",
    "transition_in": "<type>",
    "voiceover": "≤18 words",
    "focal"?, "roles"?, "sfx"?, "poster"?, "asset_candidates"?, "status"?, "src"?, "assets"?,
    "layers": { "background"?, "midground"?, "foreground"? }
  }]
}

## Narrative Arc: "${narrativeArcId || 'Feature_Benefit'}"
Beats: ${(narrativeArc?.beats || []).join(' → ')}
${narrativeArc?.description || 'Feature-Benefit Cascade'}

Return ONLY valid JSON. ${NO_MARKDOWN_SUFFIX}`
}
