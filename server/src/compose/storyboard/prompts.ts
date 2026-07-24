// Storyboard prompt: asks LLM to produce a structured JSON storyboard.
import type { ComposeContext } from "../chapters/types"
import type { VideoModel, ShotType } from "../model"

/**
 * Build the user prompt for storyboard generation.
 * Asks the LLM to act as a professional video director and output
 * a JSON storyboard with 8-12 shots, including narration per shot.
 */
export function buildStoryboardPrompt(ctx: ComposeContext, model: VideoModel): string {
  const features = ctx.copy.features.map((f) => `- ${f.title}: ${f.desc}`).join("\n")
  const stats = ctx.copy.stats.map((s) => `- ${s.value} ${s.label}`).join("\n")
  const screenshots = ctx.screenshots
    .map((s, i) => `- [Screenshot ${i + 1}] ${s.caption} (path: ${s.path})`)
    .join("\n")
  const logos = ctx.logos.length > 0 ? `\nTrusted logos: ${ctx.logos.join(", ")}` : ""
  const pricing = ctx.pricing.length > 0
    ? `\nPricing:\n${ctx.pricing.map((p) => `- ${p.name}: ${p.price}`).join("\n")}`
    : ""

  // Build the list of available shot types from the model
  const availableShotTypes: ShotType[] = [
    "brand-center", "brand-side",
    "hero-split", "hero-stack",
    "shot-window", "shot-tilt", "shot-zoom", "shot-split",
    "feature-row", "feature-stack",
    "data-counter", "chips-marquee",
    "logo-wall", "pricing",
    "cta-push", "cta-fullbleed",
  ]

  return `You are a professional video director. Design a storyboard for a brand product video.

## Brand Info
- Brand: "${ctx.brand.title}"
- Tagline: "${ctx.brand.tagline}"
- Tone: ${ctx.tone}
- Skin/Visual System: ${ctx.skin.id} (${ctx.skin.motion.transition} transitions)
- Font: ${ctx.fontFamily}
- Total Duration: ${ctx.durationSec} seconds

## Color Palette
- fg: ${ctx.palette.fg}, bg: ${ctx.palette.bg}, accent: ${ctx.palette.accent}
- accentFg: ${ctx.palette.accentFg}, muted: ${ctx.palette.muted}
- secondary: ${ctx.palette.secondary}, border: ${ctx.palette.border}

## Copy & Content
- Headline: "${ctx.copy.headline}"
- Subheadline: "${ctx.copy.subheadline}"
- CTA buttons: ${ctx.copy.ctas.join(", ")}
${features ? `\nFeatures:\n${features}` : ""}
${stats ? `\nStatistics:\n${stats}` : ""}
${screenshots || "\n(no screenshots available)"}
${logos}${pricing}

## CTA
- Headline: "${ctx.cta.headline}"
- Command/URL: "${ctx.cta.command}"

## Available Shot Types
${availableShotTypes.map((t) => `- ${t}`).join("\n")}

## Requirements
1. Create exactly 8-12 shots that form a cohesive brand video narrative.
2. First shot MUST be "brand-center" or "brand-side" (opening brand reveal).
3. Last shot MUST be "cta-push" or "cta-fullbleed" (closing call to action).
4. Each shot must have a duration of at least 2 seconds.
5. Total duration of all shots must equal ${ctx.durationSec} seconds.
6. Shots must have sequential startTime values (no overlaps, no gaps).
7. Each shot must include a "narration" field: a short voiceover script (max 18 words) that a narrator would speak during this shot. The narration should be benefit-oriented, concise, and match the brand tone.
8. Assign each shot to a chapter: "ch1-opening", "ch2-hero", "ch3-showcase", "ch4-proof", or "ch5-cta".
9. Use the product's REAL content from the capture data above. NEVER fabricate statistics, pricing, or partner names.
10. Vary shot types — don't repeat the same type consecutively.
11. For screenshot shots (shot-window/shot-tilt/shot-zoom/shot-split), include the asset path in "assets".
12. Choose transitions that match the skin: ${ctx.skin.motion.transition} is preferred, but you may use others for variety.
13. You MAY use video elements for product demos. Videos must have: autoplay muted loop playsinline attributes. Video src must reference assets/ directory (e.g. "assets/video-0.mp4"). Use GSAP to control playback.

## Output Format
Return ONLY a valid JSON object with this exact structure (no markdown, no code fences, no explanation):

{
  "meta": {
    "brand": "${ctx.brand.title}",
    "tagline": "${ctx.brand.tagline}",
    "tone": "${ctx.tone}",
    "totalDuration": ${ctx.durationSec},
    "skin": "${ctx.skin.id}",
    "fontFamily": ${JSON.stringify(ctx.fontFamily)},
    "palette": {
      "fg": "${ctx.palette.fg}",
      "bg": "${ctx.palette.bg}",
      "accent": "${ctx.palette.accent}",
      "accentFg": "${ctx.palette.accentFg}",
      "muted": "${ctx.palette.muted}",
      "secondary": "${ctx.palette.secondary}",
      "border": "${ctx.palette.border}"
    }
  },
  "shots": [
    {
      "id": "shot-01",
      "type": "brand-center",
      "chapter": "ch1-opening",
      "startTime": 0,
      "duration": 3,
      "visualDescription": "Brand logo reveal with subtle grid background and accent glow",
      "screenText": {
        "headline": "${ctx.brand.title}",
        "subheadline": "${ctx.brand.tagline}",
        "eyebrow": "INTRODUCING"
      },
      "narration": "Introducing ${ctx.brand.title}, ${ctx.brand.tagline}",
      "transition": "${ctx.skin.motion.transition}",
      "layers": {
        "background": { "type": "grid", "color": "${ctx.palette.border}", "opacity": 0.3 },
        "midground": { "type": "glow", "color": "${ctx.palette.accent}", "opacity": 0.15 }
      },
      "choreography": { "enterEase": "power3.out", "stagger": 0.12, "exitDelay": 0.3 },
      "cameraMotion": "slow zoom in"
    }
  ]
}

Each shot in "shots" must follow this schema:
{
  "id": string,           // e.g. "shot-01", "shot-02", ...
  "type": ShotType,       // one of the available shot types listed above
  "chapter": ChapterId,   // "ch1-opening" | "ch2-hero" | "ch3-showcase" | "ch4-proof" | "ch5-cta"
  "startTime": number,    // seconds, sequential, no gaps
  "duration": number,     // seconds, minimum 2
  "visualDescription": string,  // detailed description of what this shot looks like
  "screenText": {         // optional on-screen text overlay
    "headline"?: string,
    "subheadline"?: string,
    "eyebrow"?: string,
    "labels"?: string[],
    "data"?: Array<{ "value": string, "label": string }>,
    "command"?: string
  },
  "narration": string,    // REQUIRED: short voiceover script, max 18 words
  "transition": string,   // "crossfade" | "flash" | "cut" | "wipe" | "slide-left" | "zoom-in"
  "assets"?: string[],    // screenshot paths for shot-window/tilt/zoom/split
  "cameraMotion"?: string, // e.g. "slow zoom in", "pan left", "tilt up"
  "layers"?: {            // background/midground/foreground layer specs
    "background"?: { "type": string, "color"?: string, "opacity"?: number },
    "midground"?: { "type": string, "color"?: string, "opacity"?: number },
    "foreground"?: { "type": string, "color"?: string, "opacity"?: number }
  },
  "choreography"?: {      // animation choreography
    "enterEase": string,
    "stagger": number,
    "exitDelay": number
  }
}

Return ONLY the JSON object. No markdown fences, no explanation.`
}
