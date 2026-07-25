// LLM chapter generation with template fallback.
// Three-level fallback: HTML Agent → legacy LLM → template-fallback → safety net
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"
import { callStepMessages } from "../../lib/step-client"
import { logger } from "../../lib/logger"
import type { ChapterId, ChapterHtml, ComposeContext } from "./types"
import type { VideoModel } from "../model"
import {
  buildSystemPrompt,
  buildChapterPrompt,
  extractHtmlFromResponse,
} from "./prompts"
import { generateChapterHtml, checkScreenshotUtilization, selectScreenshotsForChapter } from "./html-agent"
import { validateHyperFramesHtml } from "./validate"
import { renderTemplateChapter } from "./template-fallback"

/**
 * Generate all 5 chapters via HTML Agent with per-chapter validation and fallback.
 *
 * Strategy (per chapter, 5 individual calls):
 *   1. HTML Agent (generateChapterHtml) — enhanced prompt with screenshot enforcement
 *   2. Legacy LLM (callStepMessages) — original prompt path as fallback
 *   3. Template fallback (renderTemplateChapter) — if both LLM paths fail
 *
 * Each chapter is validated after generation. Failed chapters fall back to
 * renderTemplateChapter() from template-fallback.ts.
 */
export async function generateChapters(
  ctx: ComposeContext,
  captureDir: string,
  model: VideoModel,
): Promise<ChapterHtml[]> {
  const systemPrompt = buildSystemPrompt(ctx)
  const results = new Map<ChapterId, ChapterHtml>()
  const assetFiles = await listAssetFiles(captureDir)
  const allScreenshotPaths = ctx.screenshots.map((s) => s.path)

  // Generate each chapter individually with three-level fallback
  const allIds: ChapterId[] = ["ch1-opening", "ch2-hero", "ch3-showcase", "ch4-proof", "ch5-cta"]

  for (const chapterId of allIds) {
    const chapterResult = await generateChapterWithFallback(
      chapterId, ctx, systemPrompt, allScreenshotPaths, assetFiles, captureDir, model,
    )
    results.set(chapterId, chapterResult)
  }

  // Return in canonical order
  const results_ = allIds.map((id) => {
    const ch = results.get(id)
    if (ch) return ch
    // Safety net: should not reach here, but fallback just in case
    logger.warn("generate:safety_net_fallback", { chapter: id })
    return fallbackToTemplate(id, model, assetFiles, captureDir)
  })
  logger.info("generate:summary", {
    llm: results_.filter((c) => c.source === "llm").length,
    template: results_.filter((c) => c.source === "template").length,
    details: results_.map((c) => ({ id: c.id, source: c.source })),
  })
  return results_
}

/**
 * Generate a single chapter with three-level fallback:
 *   1. HTML Agent (enhanced prompt with screenshot enforcement)
 *   2. Legacy LLM (original callStepMessages path)
 *   3. Template fallback
 */
async function generateChapterWithFallback(
  chapterId: ChapterId,
  ctx: ComposeContext,
  systemPrompt: string,
  allScreenshotPaths: string[],
  assetFiles: string[],
  captureDir: string,
  model: VideoModel,
): Promise<ChapterHtml> {
  const chapterPrompt = buildChapterPrompt(chapterId, ctx)

  // --- Level 1: HTML Agent ---
  try {
    logger.info("generate:html_agent_start", { chapter: chapterId })
    const html = await generateChapterHtml(chapterId, ctx, chapterPrompt, allScreenshotPaths)
    const validation = validateHyperFramesHtml(html, chapterId, assetFiles, join(captureDir, "assets"))
    if (validation.valid) {
      // Verify chapter-specific screenshots are actually used
      const chapterScreenshots = selectScreenshotsForChapter(chapterId, allScreenshotPaths)
      const utilization = checkScreenshotUtilization(html, chapterScreenshots)
      if (utilization.ok) {
        logger.info("generate:chapter_ok", { chapter: chapterId, source: "html_agent" })
        return { id: chapterId, html, source: "llm" }
      }
      logger.warn("generate:html_agent_missing_screenshots", { chapter: chapterId, missing: utilization.missing.length })
    } else {
      logger.warn("generate:html_agent_invalid", { chapter: chapterId, errors: validation.errors })
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.warn("generate:html_agent_failed", { chapter: chapterId, error: errMsg })
  }

  // --- Level 2: Legacy LLM ---
  try {
    logger.info("generate:legacy_llm_start", { chapter: chapterId })
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    > = [{ type: "text", text: chapterPrompt }]

    // Attach screenshot previews as base64 images
    for (const ss of ctx.screenshots.slice(0, 3)) {
      if (ss.base64Preview) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: ss.base64Preview },
        })
      }
    }

    const response = await callStepMessages({
      system: systemPrompt,
      content,
      maxTokens: 8000,
      model: "step-explore",
    })
    logger.info("generate:legacy_llm_response", { chapter: chapterId, responseLen: response?.length || 0 })
    const html = extractHtmlFromResponse(response)
    const validation = validateHyperFramesHtml(html, chapterId, assetFiles, join(captureDir, "assets"))
    if (validation.valid) {
      // Legacy LLM path: also check chapter-specific screenshot utilization (relaxed — only warn)
      const chapterScreenshots = selectScreenshotsForChapter(chapterId, allScreenshotPaths)
      const utilization = checkScreenshotUtilization(html, chapterScreenshots)
      if (!utilization.ok) {
        logger.warn("generate:legacy_llm_missing_screenshots", { chapter: chapterId, missing: utilization.missing.length })
      }
      logger.info("generate:chapter_ok", { chapter: chapterId, source: "legacy_llm" })
      return { id: chapterId, html, source: "llm" }
    }
    logger.warn("generate:legacy_llm_invalid", { chapter: chapterId, errors: validation.errors })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error("generate:legacy_llm_failed", { chapter: chapterId, error: errMsg })
  }

  // --- Level 3: Template fallback ---
  logger.warn("generate:template_fallback", { chapter: chapterId })
  return fallbackToTemplate(chapterId, model, assetFiles, captureDir)
}

/** Fallback: render a chapter using the template system */
function fallbackToTemplate(
  id: ChapterId,
  model: VideoModel,
  _assetFiles: string[],
  _captureDir: string,
): ChapterHtml {
  logger.info("generate:fallback_template", { chapter: id })
  return { id, html: renderTemplateChapter(id, model), source: "template" }
}

/** List asset files in capture/assets/ for validation */
async function listAssetFiles(captureDir: string): Promise<string[]> {
  try {
    const files = await readdir(join(captureDir, "assets"))
    return files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  } catch {
    return []
  }
}

/**
 * Build a ComposeContext from a capture directory and VideoModel.
 * Reuses palette/text data already parsed by model.ts.
 */
export async function buildComposeContext(captureDir: string, model: VideoModel): Promise<ComposeContext> {
  // Build screenshot base64 previews (compressed to 800px wide JPEG for token control)
  const screenshots = await buildScreenshotPreviews(captureDir, model)

  // Derive tone from skin
  const toneMap: Record<string, "bold" | "calm" | "technical"> = {
    kinetic: "bold",
    editorial: "calm",
    technical: "technical",
  }
  const tone = toneMap[model.skin.id] || "calm"

  return {
    brand: {
      title: model.brand.title,
      tagline: model.brand.tagline,
      description: model.brand.tagline,
    },
    palette: {
      fg: model.palette.fg,
      bg: model.palette.bg,
      accent: model.palette.accent,
      accentFg: model.palette.accentFg,
      muted: model.palette.muted,
      secondary: model.palette.secondary,
      border: model.palette.border,
    },
    copy: {
      headline: model.hero.headline,
      subheadline: model.hero.lede,
      ctas: model.hero.ctas,
      features: model.valueProps,
      stats: model.scenes.flatMap((s) => s.stats || []),
    },
    screenshots,
    fontFamily: model.palette.fontFamily,
    tone,
    durationSec: model.durationSec,
    skin: model.skin,
    logos: model.logos,
    pricing: model.pricing,
    hero: model.hero,
    cta: model.cta,
  }
}

/** Compress screenshots to 800px wide JPEG base64 for LLM vision input */
async function buildScreenshotPreviews(
  captureDir: string,
  model: VideoModel,
): Promise<Array<{ path: string; base64Preview: string; caption: string }>> {
  const results: Array<{ path: string; base64Preview: string; caption: string }> = []

  // Collect screenshot paths from scenes
  const shotPaths: Array<{ src: string; caption: string }> = []
  for (const scene of model.scenes) {
    for (const shot of scene.shots || []) {
      if (shot.src) shotPaths.push({ src: shot.src, caption: shot.caption })
    }
  }

  // Limit to first 5 screenshots
  for (const { src, caption } of shotPaths.slice(0, 8)) {
    const fullPath = join(captureDir, src)
    try {
      const buf = await sharp(fullPath)
        .resize(800, undefined, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 60, mozjpeg: true })
        .toBuffer()
      const base64 = buf.toString("base64")
      results.push({ path: src, base64Preview: base64, caption })
    } catch {
      logger.warn("generate:screenshot_compress_failed", { src, error: "sharp failed" })
    }
  }

  return results
}
