// LLM prompt templates for the 5-chapter generation pipeline.
// LLM directly generates full HTML for each chapter.
import type { ChapterId, ComposeContext } from "./types"

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

/**
 * Common system prompt: HyperFrames sub-composition specification.
 * Enforced for ALL chapter generations to guarantee structural conformance.
 */
const SYSTEM_PROMPT = `You are a HyperFrames sub-composition generator. You produce a single self-contained HTML file for one chapter of a brand video.

## Canvas & Structure
- Fixed canvas: 1920×1080 pixels
- Root element: \`<div data-composition-id="{CHAPTER_ID}" data-width="1920" data-height="1080">\`
- Every animated element is a clip: \`<div class="clip" data-start="{seconds}" data-duration="{seconds}" data-track-index="1">\`

## GSAP Animation Rules
- Load GSAP from CDN: ${GSAP_CDN}
- Every timeline MUST be created as: \`gsap.timeline({ paused: true })\`
- Register to: \`window.__timelines["{CHAPTER_ID}"] = tl;\`
- Initialize: \`window.__timelines = window.__timelines || {};\`
- ONLY use transform and opacity for animations (GPU-composited, no reflow)
- Use professional easing: "power2.out", "power3.out", "expo.out", "back.out(1.6)"

## Visual Design Rules
- Every pixel must carry information. No decorative gradients, no empty glass panels, no filler.
- Each scene must contain 12-20 visible elements (text blocks, icons, cards, buttons, labels, data values, dividers, etc.)
- Use the product's ACTUAL UI patterns: navigation bars, sidebars, tab panels, data tables, form inputs, card grids, terminal windows, code blocks.
- Recreate what the product LOOKS LIKE, not what you imagine it might look like.
- Background must include subtle grid patterns, dot patterns, or gradient meshes — never flat solid color.
- Use realistic content from the capture data. NEVER fabricate statistics, pricing, or partner names.
- Minimize long paragraphs. Use short headlines (max 8 words), bullet points, and visual elements.

## Screenshot Container Structure (MANDATORY)
- Any screenshot/image display MUST use this exact DOM structure:
  <div class="window"><div class="viewport"><img class="shot-visual" src="..." /></div></div>
- The .window container MUST have multi-layer box-shadow:
  box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3);
- The .shot-visual img MUST have an independent fade-in entry animation
  (separate from the .window entry), creating a layered entrance effect.

## Animation Choreography
- Every element must have an entry animation (fade+slide, scale, or blur-in).
- Stagger entries: elements enter one by one with 0.1-0.2s delays, creating a cascade effect.
- Use at least 2 different easing functions per scene (e.g. power3.out for headlines, back.out for cards).
- Elements that exit should fade out or slide out before the scene ends — no hard cuts.
- Add subtle continuous motion: floating elements (y: ±3px, duration: 2-3s, yoyo, repeat: -1), pulsing glows, or slow rotations.
- Use clip-path reveals for headlines: clip-path: inset(0 100% 0 0) → inset(0 0 0 0).
- Layered entry choreography: background → main content (fade+slide) → detail elements (stagger)
- Screenshot containers: .window enters with fade+slide+scale first, then .shot-visual fades in independently 0.3s later

## Typography Rules
- Headlines: 48-80px, font-weight 700-800, letter-spacing: -1px to -2px, max 8 words per line.
- Subheadlines: 20-28px, font-weight 400-500, color: var(--muted), max 16 words.
- Body text: 14-16px, line-height: 1.5-1.6.
- Labels/tags: 12-14px, text-transform: uppercase, letter-spacing: 2-4px.
- NEVER let text wrap awkwardly. Use max-width and text-overflow: ellipsis.
- Use word-break: keep-all for CJK text to prevent awkward mid-word breaks.

## Timeline Rules
- Your chapter has a fixed duration. ALL clips must fit within this duration.
- Leave 0.2-0.3s gap between consecutive clips for clean transitions.
- Do NOT overlap clips on the same track.
- First element enters at data-start="0" (no delay).
- Last element exits at least 0.3s before chapter ends.
- Each clip's data-start + data-duration MUST NOT exceed the chapter duration.

## Brand Context
- Font family: {FONT_FAMILY}
- Colors via CSS variables: --fg, --bg, --accent, --accent-fg, --muted, --secondary, --border

## Forbidden
- NO <iframe>, <form>, fetch(), XMLHttpRequest
- NO CSS @keyframes (use GSAP timelines only)
- NO external resource loading except GSAP CDN
- NO flat static layouts — every scene must have continuous motion (Ken Burns drift, floating, pulsing)
- NO element should remain visually static for more than 1.5 seconds
- Screenshots MUST use Ken Burns effect: slow scale(1)→scale(1.04) + slight translate over full duration

## Output Format
Return ONLY the complete HTML file. No markdown, no code fences, no explanation.`

/**
 * Build the system prompt with chapter-specific font/color context injected.
 */
export function buildSystemPrompt(ctx: ComposeContext): string {
  return SYSTEM_PROMPT
    .replace(/\{FONT_FAMILY\}/g, ctx.fontFamily)
}

/**
 * Build the user prompt for a specific chapter.
 * Each chapter type has different content requirements and timing constraints.
 */
export function buildChapterPrompt(chapterId: ChapterId, ctx: ComposeContext): string {
  const palette = ctx.palette
  const colorBlock = `
Colors:
- --fg: ${palette.fg} (foreground/text)
- --bg: ${palette.bg} (background)
- --accent: ${palette.accent} (brand accent)
- --accent-fg: ${palette.accentFg} (text on accent)
- --muted: ${palette.muted} (secondary text)
- --secondary: ${palette.secondary} (secondary bg)
- --border: ${palette.border} (borders)`

  switch (chapterId) {
    case "ch1-opening":
      return buildOpeningPrompt(ctx, colorBlock)
    case "ch2-hero":
      return buildHeroPrompt(ctx, colorBlock)
    case "ch3-showcase":
      return buildShowcasePrompt(ctx, colorBlock)
    case "ch4-proof":
      return buildProofPrompt(ctx, colorBlock)
    case "ch5-cta":
      return buildCtaPrompt(ctx, colorBlock)
  }
}

function buildOpeningPrompt(ctx: ComposeContext, colors: string): string {
  return `Generate Chapter 1: OPENING / Problem Statement

Duration: 2-3 seconds
Chapter ID: ch1-opening
Skin: ${ctx.skin.id} (${ctx.skin.motion.transition} transition)

Brand:
- Name: "${ctx.brand.title}"
- Tagline: "${ctx.brand.tagline}"
${colors}

## Chapter 1: Opening / Problem Statement
Create a high-impact opening scene (12-15 elements):
- Background: subtle grid pattern or dot matrix with brand accent glow (use CSS linear-gradient for grid, mask-image for fade)
- Top bar: brand logo/icon (left) + small label like "open source" or version badge (right), both 14px uppercase with letter-spacing
- Brand logo/icon centered, large (80-120px), with clip-path reveal animation
- Brand name below logo, 48-64px, font-weight 700-800, letter-spacing: -1px to -2px, with staggered letter entrance
- Tagline: max 8 words, 20-24px, muted color, fade-in from below
- Eyebrow label above headline: 14-18px, uppercase, letter-spacing: 3px, accent color
- 2-3 decorative elements: floating geometric shapes (rotated squares, circles with borders), gradient orbs, or abstract connector lines
- Bottom: small label "Powered by ${ctx.brand.title}" or stamp text in monospace
- All elements enter with staggered cascade (0.1s delays between each)
- Continuous subtle motion on decorative elements (y: ±3px, yoyo, repeat: -1)
- Exit animations: elements fade/slide out 0.3s before chapter ends — no hard cuts

Animation choreography:
- t=0: background grid fades in
- t=0.1s: top bar slides down from above
- t=0.2s: eyebrow label fades in
- t=0.3s: brand name enters with clip-path reveal or scale+fade
- t=0.5s: tagline fades up from below
- t=0.7s: decorative elements pop in with stagger (0.1s each)
- t=0.9s: bottom stamp slides in from right
- Exit: all elements fade/slide out before chapter ends

Output the complete sub-composition HTML file.`
}

function buildHeroPrompt(ctx: ComposeContext, colors: string): string {
  const chips = ctx.hero.chips.length > 0 ? `\nChips/tags: ${ctx.hero.chips.join(", ")}` : ""
  const ctas = ctx.hero.ctas.length > 0 ? `\nCTA buttons: ${ctx.hero.ctas.join(", ")}` : ""

  return `Generate Chapter 2: Product Interface

Duration: 3-5 seconds
Chapter ID: ch2-hero
Skin: ${ctx.skin.id} (${ctx.skin.motion.transition} transition)

Content:
- Headline: "${ctx.hero.headline}"
- Subheadline: "${ctx.hero.lede}"${ctas}${chips}
${colors}

## Chapter 2: Product Interface
Recreate the product's actual main screen as seen in the screenshots. This is NOT a decorative mockup — it must look like the real product UI.

Required elements (minimum 15 total):
- Background: subtle grid pattern (CSS linear-gradient) with mask fade at bottom
- Top navigation bar: brand logo (left), 3-4 menu items (center or left), CTA button (right-aligned). Nav items are 14-16px, CTA button has accent background with rounded corners
- Center hero area matching the real product:
  - If it's a chat interface: show a chat input with placeholder text, send button, maybe a conversation bubble
  - If it's a dashboard: show metric cards (2-3), a chart placeholder area, data labels
  - If it's a code/CLI tool: show a terminal window with command prompt, colored output lines, monospace font
  - If it's a design tool: show a canvas area with tool panels, layers, property inspectors
- Use REAL text from the capture data for labels, buttons, and placeholders
- Headline overlay: 48-64px, bold, positioned over the interface with proper contrast
- Below hero: 2-3 feature chips or stat badges with border, uppercase labels
- Every area must have content — no empty space, no filler gradients

Animation choreography:
- Nav bar slides down from top (power3.out, 0.5s)
- Hero interface area fades up from below (expo.out, 0.6s)
- Individual UI elements within the interface stagger in (0.1-0.15s delays)
- Feature chips pop in with scale(0.8)→scale(1) + fade (back.out, 0.15s stagger)
- CTA button enters last with bounce effect
- Continuous: subtle floating on decorative elements, pulse on CTA button
- Exit: interface slides left + fades, headline fades up — 0.3s before chapter ends

Output the complete sub-composition HTML file.`
}

function buildShowcasePrompt(ctx: ComposeContext, colors: string): string {
  const screenshots = ctx.screenshots.map((s, i) =>
    `[Screenshot ${i + 1}] ${s.caption} (path: assets/${s.path.replace(/^assets\//, "")})`
  ).join("\n")

  return `Generate Chapter 3: Visual Showcase (Product Screenshots)

Duration: 5-8 seconds
Chapter ID: ch3-showcase
Skin: ${ctx.skin.id} (${ctx.skin.motion.transition} transition)

Screenshots to feature:
${screenshots || "(no screenshots available — use placeholder compositions)"}
${colors}

This is the MOST IMPORTANT chapter — it shows the actual product.

## Chapter 3: Visual Showcase
Display 2-3 product screenshots in styled browser window frames (12-15 elements total):

Browser frame design:
- Each frame: rounded corners (12-16px), subtle shadow (0 20px 60px rgba(0,0,0,0.15)), thin border (1px solid var(--border))
- Frame header bar: 3 colored dots (red #ff5f57, yellow #febc2e, green #28c840) + URL bar with truncated domain in monospace 13px
- Frame body: the actual screenshot image, object-fit: cover

Layout and content:
- Background: subtle grid pattern with mask fade
- Top bar: brand logo (left) + scene counter label like "01 / product interface" (right), uppercase 14px
- 2-3 frames arranged with overlap or side-by-side, each showing a different screenshot
- Small caption label below each frame: 14px, muted color, describing the feature shown
- Optional: small badge/tag on each frame (e.g. "Dashboard", "API Panel")

Animation choreography:
- Background grid fades in first
- Top bar slides down
- Frame 1 enters with scale(0.9)→scale(1) + fade from center (0.6s, power3.out)
- Frame 2 enters 0.3s after Frame 1, same animation
- Frame 3 enters 0.3s after Frame 2
- Ken Burns effect on each screenshot: slow zoom scale(1)→scale(1.05) + slight translate over 3-4s, continuous
- Captions fade up 0.2s after their frame enters
- Add subtle reflection/glow below each frame (gradient div, opacity 0.15)
- Exit: frames slide out to left with stagger, fade out — 0.3s before chapter ends

IMPORTANT: Reference screenshot images using relative paths like: src="assets/filename.webp"

Output the complete sub-composition HTML file.`
}

function buildProofPrompt(ctx: ComposeContext, colors: string): string {
  const features = ctx.copy.features.map((f) => `- ${f.title}: ${f.desc}`).join("\n")
  const stats = ctx.copy.stats.map((s) => `- ${s.value} ${s.label}`).join("\n")
  const logos = ctx.logos.length > 0 ? `\nTrusted logos: ${ctx.logos.join(", ")}` : ""
  const pricing = ctx.pricing.length > 0
    ? `\nPricing:\n${ctx.pricing.map((p) => `- ${p.name}: ${p.price}`).join("\n")}`
    : ""

  return `Generate Chapter 4: Social Proof / Capabilities

Duration: 5-8 seconds
Chapter ID: ch4-proof
Skin: ${ctx.skin.id} (${ctx.skin.motion.transition} transition)

Content:
Features:
${features || "(no features provided)"}

Statistics:
${stats || "(no statistics provided)"}
${logos}${pricing}
${colors}

## Chapter 4: Social Proof / Capabilities
Show the product's real capabilities and trust signals (12-15 elements):

Required layout:
- Background: subtle grid pattern with mask fade
- Top bar: brand logo (left) + section label (right)
- Section title: "Capabilities" or "Why ${ctx.brand.title}" (32-40px, bold, letter-spacing: -1px)
- Eyebrow label above title: 14px, uppercase, accent color, letter-spacing: 3px
- 3-4 feature cards in a row: each card contains:
  - Icon or emoji (24-32px)
  - Title: max 4 words, 16-18px, bold
  - One-line description: 14px, muted color, max 12 words
- Use REAL feature data from capture. If no real data, show product UI patterns (API panel, model selector, terminal, etc.)
- NEVER fabricate statistics, pricing, or partner names
- If stats available: show 2-3 summary cells with large numbers (30px, bold, accent color) + small labels (12px, uppercase)
- If logos available: arrange in a row with even spacing, each 40-60px height

Animation choreography:
- Title area enters with slide from left + fade (power3.out, 0.6s)
- Summary cells pop in with stagger (0.15s delays, scale 0.8→1)
- Feature cards enter with stagger: scale(0.8)→scale(1) + fade, 0.15s delays between each
- Add subtle highlight on center card (scale 1.05, accent border glow) — continuous pulse
- Stats count up from 0 to final values using GSAP counter (textContent in onUpdate)
- Legend or footer labels fade in last
- Exit: cards slide out with stagger, title fades — 0.3s before chapter ends

Output the complete sub-composition HTML file.`
}

function buildCtaPrompt(ctx: ComposeContext, colors: string): string {
  return `Generate Chapter 5: Closing / Call to Action

Duration: 2-3 seconds
Chapter ID: ch5-cta
Skin: ${ctx.skin.id} (${ctx.skin.motion.transition} transition)

Content:
- CTA Headline: "${ctx.cta.headline}"
- Command/URL: "${ctx.cta.command}"
${colors}

## Chapter 5: Closing / Call to Action
Create a memorable closing scene (8-10 elements):

Required layout:
- Background: brand gradient or dark with accent glow (radial-gradient from center, accent color at 10-15% opacity)
- Background grid pattern overlay (subtle, masked)
- Top bar: brand logo (left) + small label (right)
- Main CTA text: 48-64px, bold, centered, max 6 words, letter-spacing: -1px
- Subtitle: 18-24px, muted color, below CTA, max 12 words
- CTA button: rounded (8-12px), accent background, bold text, with pulse animation (scale 1→1.05→1, repeat: -1, duration: 1.5s)
- Command/URL in monospace terminal-style treatment below button (14-16px, muted, with copy-like styling)
- Brand logo small at bottom center
- 2-3 decorative elements: floating particles, gradient orbs, or geometric shapes (rotated squares with border)
- Decorative scanline or accent line that animates across screen

Animation choreography:
- Background fades in with grid
- CTA headline enters with bold slide from below + fade (power3.out, 0.5s)
- Subtitle fades up 0.15s after headline
- Button enters with bounce (back.out, 0.4s) — enters last among content
- Command/URL fades in 0.1s after button
- Decorative elements pop in with stagger (0.1s delays)
- Scanline animates across screen (scaleX 0→1, 0.6s)
- All elements hold for 0.5s at end — gentle fade out for last 0.3s

Output the complete sub-composition HTML file.`
}

/**
 * Get the list of chapter IDs that can be batch-generated in a single LLM call
 * (no screenshots, low token count).
 */
export function getBatchableChapterIds(): ChapterId[] {
  return ["ch1-opening", "ch5-cta"]
}

/**
 * Get the list of chapter IDs that need individual LLM calls (have screenshots).
 */
export function getIndividualChapterIds(): ChapterId[] {
  return ["ch2-hero", "ch3-showcase", "ch4-proof"]
}

/**
 * Build a combined prompt for batch chapters (Ch1 + Ch5).
 */
export function buildBatchPrompt(chapterIds: ChapterId[], ctx: ComposeContext): string {
  const parts = chapterIds.map((id) => buildChapterPrompt(id, ctx))
  return `Generate the following ${chapterIds.length} chapters in sequence. Output each chapter as a separate HTML document, delimited by "---CHAPTER: {chapterId}---" markers.

${parts.join("\n\n---\n\n")}

IMPORTANT: Output each chapter separated by exactly:
---CHAPTER: ch1-opening---
[html content]
---CHAPTER: ch5-cta---
[html content]`
}

/**
 * Extract HTML from LLM response that may contain markdown code fences.
 */
export function extractHtmlFromResponse(response: string): string {
  // Remove markdown code fences if present
  let html = response
    .replace(/^```(?:html|HTML)?\s*\n?/gm, "")
    .replace(/```\s*$/gm, "")
    .trim()
  return html
}

/**
 * Parse a batch response containing multiple chapters separated by markers.
 */
export function parseBatchResponse(response: string): Map<ChapterId, string> {
  const result = new Map<ChapterId, string>()
  const markerPattern = /---CHAPTER:\s*(ch[1-5]-[a-z]+)---/g
  const markers: Array<{ id: ChapterId; index: number }> = []

  let match
  while ((match = markerPattern.exec(response)) !== null) {
    markers.push({ id: match[1] as ChapterId, index: match.index + match[0].length })
  }

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index
    const end = i + 1 < markers.length
      ? response.lastIndexOf("---CHAPTER:", markers[i + 1]!.index)
      : response.length
    const html = extractHtmlFromResponse(response.slice(start, end).trim())
    result.set(markers[i]!.id, html)
  }

  return result
}
