// HTML Agent: chapter-aware LLM generation with per-chapter screenshot allocation.
// Mirrors the original generate.ts allocation, with added HTML Agent structure:
//   - ch3-showcase: first 3 screenshots (main product showcase)
//   - ch2-hero: first 2 screenshots (product UI reference, optional)
//   - ch1/ch4/ch5: NO screenshots (text/brand/stats focused)
import { callStepMessages } from "../../lib/step-client"
import { logger } from "../../lib/logger"
import type { ChapterId, ComposeContext } from "./types"
import { buildSystemPrompt, extractHtmlFromResponse } from "./prompts"

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

// ---------------------------------------------------------------------------
// Per-chapter screenshot policy
// ---------------------------------------------------------------------------

export interface ChapterScreenshotPolicy {
  /** How many screenshots this chapter should use (0 = none) */
  maxCount: number
  /** Whether using screenshots is mandatory or optional */
  mandatory: boolean
  /** Human-readable role description for the prompt */
  role: string
}

/**
 * Return the screenshot policy for a given chapter.
 * Mirrors the original generate.ts allocation:
 *   - ch3-showcase: first 3 screenshots (was ctx.screenshots.slice(0, 3))
 *   - ch2-hero: first 2 screenshots (was ctx.screenshots.slice(0, 2))
 *   - ch1/ch4/ch5: no screenshots
 */
export function getChapterScreenshotPolicy(chapterId: ChapterId): ChapterScreenshotPolicy {
  switch (chapterId) {
    case "ch3-showcase":
      // Showcase gets ALL screenshots — user wants maximum screenshot utilization
      return { maxCount: 99, mandatory: true, role: "main product showcase — display ALL allocated screenshots" }
    case "ch2-hero":
      return { maxCount: 2, mandatory: false, role: "product UI reference — optionally include 1-2 screenshots" }
    default:
      // ch1-opening, ch4-proof, ch5-cta: no screenshots
      return { maxCount: 0, mandatory: false, role: "no screenshots needed — focus on text, brand, stats, and layout" }
  }
}

/**
 * Select the screenshot paths allocated to a specific chapter.
 */
export function selectScreenshotsForChapter(
  chapterId: ChapterId,
  allScreenshotPaths: string[],
): string[] {
  const policy = getChapterScreenshotPolicy(chapterId)
  if (policy.maxCount === 0) return []
  return allScreenshotPaths.slice(0, policy.maxCount)
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate a single chapter's HTML via the HTML Agent prompt.
 *
 * Screenshot allocation mirrors the original generate.ts:
 *   - ch3-showcase gets first 3 screenshots
 *   - ch2-hero gets first 2
 *   - ch1/ch4/ch5 get none
 *
 * If the LLM call throws, the function re-throws so the caller can fall back.
 */
export async function generateChapterHtml(
  chapterId: ChapterId,
  ctx: ComposeContext,
  chapterPrompt: string,
  allScreenshotPaths: string[],
): Promise<string> {
  // Select only the screenshots this chapter needs
  const chapterScreenshots = selectScreenshotsForChapter(chapterId, allScreenshotPaths)
  const policy = getChapterScreenshotPolicy(chapterId)

  const systemPrompt = buildSystemPrompt(ctx)
  const agentPrompt = buildAgentPrompt(chapterId, ctx, chapterPrompt, chapterScreenshots, policy)

  // Build content blocks — only attach base64 previews for THIS chapter's screenshots
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  > = [{ type: "text", text: agentPrompt }]

  const chapterScreenshotSet = new Set(chapterScreenshots.map((p) => p.replace(/^assets\//, "")))
  for (const ss of ctx.screenshots) {
    const bareName = ss.path.replace(/^assets\//, "")
    if (ss.base64Preview && chapterScreenshotSet.has(bareName)) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: ss.base64Preview },
      })
    }
  }

  logger.info("html_agent:calling", {
    chapter: chapterId,
    policy: policy.role,
    allocatedScreenshots: chapterScreenshots.length,
    totalScreenshots: allScreenshotPaths.length,
    promptLen: agentPrompt.length,
  })

  const response = await callStepMessages({
    system: systemPrompt,
    content,
    maxTokens: 8000,
    model: "step-explore",
  })

  logger.info("html_agent:response", { chapter: chapterId, responseLen: response?.length || 0 })

  const html = extractHtmlFromResponse(response)
  return html
}

// ---------------------------------------------------------------------------
// Post-generation utilization check
// ---------------------------------------------------------------------------

/**
 * Check whether the generated HTML actually references every expected screenshot.
 * Returns { ok: true } when all paths are present, or { ok: false, missing } listing
 * the paths that were not found in any <img> src attribute.
 */
export function checkScreenshotUtilization(
  html: string,
  expectedScreenshotPaths: string[],
): { ok: true } | { ok: false; missing: string[] } {
  if (expectedScreenshotPaths.length === 0) return { ok: true }

  const imgSrcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]!)

  const missing: string[] = []
  for (const fullPath of expectedScreenshotPaths) {
    const bareName = fullPath.replace(/^assets\//, "")
    const found = imgSrcs.some((src) => {
      const srcBare = src.replace(/^assets\//, "")
      return srcBare === bareName || srcBare.endsWith("/" + bareName)
    })
    if (!found) missing.push(fullPath)
  }

  if (missing.length > 0) {
    logger.warn("html_agent:screenshot_utilization_check", {
      total: expectedScreenshotPaths.length,
      missing: missing.length,
      missingPaths: missing,
    })
    return { ok: false, missing }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Agent prompt builder — per-chapter screenshot handling
// ---------------------------------------------------------------------------

function buildAgentPrompt(
  chapterId: ChapterId,
  ctx: ComposeContext,
  chapterPrompt: string,
  chapterScreenshots: string[],
  policy: ChapterScreenshotPolicy,
): string {
  const palette = ctx.palette
  const colors = `Colors:
- --fg: ${palette.fg}  --bg: ${palette.bg}  --accent: ${palette.accent}
- --accent-fg: ${palette.accentFg}  --muted: ${palette.muted}
- --secondary: ${palette.secondary}  --border: ${palette.border}`

  // Build screenshot instructions based on chapter policy
  const screenshotBlock = buildScreenshotBlock(chapterScreenshots, policy)

  // Screenshot DOM rules — only include when chapter actually uses screenshots
  const screenshotDomRules = chapterScreenshots.length > 0
    ? `
## Screenshot DOM Rules (when using screenshots)
- Container: <div class="window"><div class="viewport"><img class="shot-visual" src="..." /></div></div>
- .window: box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 8px 40px rgba(0,0,0,0.3); border-radius: 12-16px
- .shot-visual: object-fit: cover; width/height 100%
- Ken Burns on each screenshot: scale(1)→scale(1.04) + slight translate, power1.inOut easing
- .shot-visual: opacity 0 initially, fade in independently 0.3s after .window enters`
    : ""

  return `You are a HyperFrames sub-composition HTML generator. Generate a single self-contained HTML file for one chapter.

## Canvas & Structure
- Fixed canvas: 1920×1080px
- Root: <div data-composition-id="${chapterId}" data-width="1920" data-height="1080">
- Load GSAP: ${GSAP_CDN}
- Timeline: gsap.timeline({ paused: true }) → window.__timelines["${chapterId}"] = tl
- Initialize: window.__timelines = window.__timelines || {};
${screenshotDomRules}

## Layout Quality
- Use position: absolute for layering — no empty area > 30% of canvas
- Minimum 8 visual elements per chapter (text blocks, cards, labels, screenshots, decorative shapes)
- Background: subtle grid/dot pattern via CSS linear-gradient, never flat solid color
- Use REAL content from the capture data. NEVER fabricate statistics or partner names.

## Animation Rules (GSAP only)
- ONLY transform + opacity animations (GPU-composited)
- Staggered entries: elements enter one-by-one with 0.1-0.2s delays
- Easing: "power2.out", "power3.out", "expo.out", "back.out(1.6)"
- Continuous motion: floating (y: ±3px, yoyo, repeat: -1), pulsing glows
- Exit animations: fade/slide out 0.3s before chapter ends
- NO CSS @keyframes — GSAP only

## Typography
- Headlines: 48-80px, weight 700-800, letter-spacing: -1px to -2px, max 8 words
- Subheadlines: 20-28px, weight 400-500, color: var(--muted)
- Labels: 12-14px, uppercase, letter-spacing: 2-4px
- word-break: keep-all for CJK text

## Brand
- Font: ${ctx.fontFamily}
${colors}

## Forbidden
- NO @keyframes, <iframe>, <form>, fetch(), XMLHttpRequest
- NO external resources except GSAP CDN
- NO flat static layouts — every scene must have continuous motion

## Output
Return ONLY the complete HTML file. No markdown, no code fences, no explanation.

---

## Chapter-Specific Instructions
${chapterPrompt}
${screenshotBlock}`
}

/**
 * Build the screenshot instruction block based on chapter policy.
 * - Showcase: lists ALL paths, mandates every one must appear
 * - Hero: lists 1-2 paths, says "use if helpful for product UI"
 * - Others: empty string (no screenshot instructions)
 */
function buildScreenshotBlock(
  chapterScreenshots: string[],
  policy: ChapterScreenshotPolicy,
): string {
  if (chapterScreenshots.length === 0) {
    // No screenshots for this chapter — explicitly tell LLM not to use any
    if (policy.maxCount === 0) {
      return `\n## Screenshots\nThis chapter does NOT use product screenshots. Focus on ${policy.role}.`
    }
    return ""
  }

  const pathList = chapterScreenshots
    .map((p, i) => `${i + 1}. assets/${p.replace(/^assets\//, "")}`)
    .join("\n")

  const domExamples = chapterScreenshots
    .map((p) => {
      const relPath = `assets/${p.replace(/^assets\//, "")}`
      return `<div class="window"><div class="viewport"><img class="shot-visual" src="${relPath}" /></div></div>`
    })
    .join("\n")

  if (policy.mandatory) {
    // ch3-showcase: MUST use ALL screenshots
    return `\n## Screenshots (YOU MUST USE ALL OF THEM)
This is the product showcase chapter. You MUST use ALL ${chapterScreenshots.length} screenshots listed below.
Every single screenshot must appear as an <img class="shot-visual"> in the HTML output.
Do NOT skip any screenshot — the user wants maximum screenshot coverage.

${pathList}

Each screenshot MUST be wrapped in its own window/viewport container:
${domExamples}

Each .shot-visual MUST have Ken Burns animation (scale + translate, power1.inOut) and opacity fade-in.
Spread screenshots across multiple scenes within this chapter for visual variety.`
  }

  // ch2-hero: optional, use if helpful
  return `\n## Screenshots (OPTIONAL — use if helpful for product UI)
You may use up to ${chapterScreenshots.length} screenshot(s) as product UI reference:

${pathList}

If you use them, wrap each in:
${domExamples}

These are for visual reference — use them to make the product interface look realistic.`
}
