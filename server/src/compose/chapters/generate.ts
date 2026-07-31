// LLM chapter generation with template fallback.
// LLM directly generates full HTML for each chapter.
// Three-level fallback: LLM HTML → template-fallback → safety net
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import sharp from "sharp"
import { callWorkerModel } from "../../ai/gateway-client"
import { logger } from "../../lib/logger"
import type { ChapterId, ChapterHtml, ComposeContext } from "./types"
import type { VideoModel } from "../model"
import {
  buildSystemPrompt,
  buildChapterPrompt,
  buildBatchPrompt,
  getBatchableChapterIds,
  extractHtmlFromResponse,
  parseBatchResponse,
} from "./prompts"
import { validateHyperFramesHtml } from "./validate"
import { renderTemplateChapter } from "./template-fallback"

/**
 * Generate all 5 chapters via LLM with per-chapter validation and fallback.
 *
 * Strategy (4 LLM calls total):
 *   1. Batch call: Ch1 + Ch5 (no screenshots, low token count)
 *   2. Individual call: Ch2 (hero with screenshots — product UI mockup)
 *   3. Individual call: Ch3 (showcase with screenshots — heaviest)
 *   4. Individual call: Ch4 (proof with stats/logos/pricing)
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

  // --- Call 1: Batch Ch1 + Ch5 ---
  const batchIds = getBatchableChapterIds()
  try {
    logger.info("generate:batch_start", { chapters: batchIds })
    const batchPrompt = buildBatchPrompt(batchIds, ctx)
    logger.info("generate:batch_calling", { chapters: batchIds, promptLen: batchPrompt.length })
    const response = await callWorkerModel({
      workload: "website-compose",
      systemPrompt,
      content: [{ type: "text", text: batchPrompt }],
      maxOutputTokens: 8000,
    })
    logger.info("generate:batch_response", { responseLen: response?.length || 0, hasContent: !!response })
    const parsed = parseBatchResponse(response)
    for (const id of batchIds) {
      const html = parsed.get(id)
      if (html) {
        const validation = validateHyperFramesHtml(html, id, assetFiles, join(captureDir, "assets"))
        if (validation.valid) {
          results.set(id, { id, html, source: "llm" })
          logger.info("generate:chapter_ok", { chapter: id, source: "llm" })
        } else {
          results.set(id, fallbackToTemplate(id, model, assetFiles, captureDir, validationReason(validation.errors)))
        }
      } else {
        results.set(id, fallbackToTemplate(id, model, assetFiles, captureDir, "batch_response_missing_chapter"))
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error("generate:batch_failed", { error: errMsg, chapters: batchIds })
    for (const id of batchIds) {
      results.set(id, fallbackToTemplate(id, model, assetFiles, captureDir, summarizeComposeError(err)))
    }
  }

  // --- Call 2: Individual Ch2 (hero with screenshots) ---
  try {
    logger.info("generate:ch2_start", { screenshots: ctx.screenshots.length })
    const ch2Prompt = buildChapterPrompt("ch2-hero", ctx)
    const content2: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    > = [{ type: "text", text: ch2Prompt }]

    // Attach first 2 screenshot previews as base64 images for product UI reference
    for (const ss of ctx.screenshots.slice(0, 2)) {
      if (ss.base64Preview) {
        content2.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: ss.base64Preview,
          },
        })
      }
    }

    const response = await callWorkerModel({
      workload: "website-compose",
      systemPrompt,
      content: content2,
      maxOutputTokens: 8000,
    })
    logger.info("generate:ch2_response", { responseLen: response?.length || 0 })
    const html = extractHtmlFromResponse(response)
    const validation = validateHyperFramesHtml(html, "ch2-hero", assetFiles, join(captureDir, "assets"))
    if (validation.valid) {
      results.set("ch2-hero", { id: "ch2-hero", html, source: "llm" })
      logger.info("generate:chapter_ok", { chapter: "ch2-hero", source: "llm" })
    } else {
      results.set("ch2-hero", fallbackToTemplate("ch2-hero", model, assetFiles, captureDir, validationReason(validation.errors)))
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error("generate:ch2_failed", { error: errMsg })
    results.set("ch2-hero", fallbackToTemplate("ch2-hero", model, assetFiles, captureDir, summarizeComposeError(err)))
  }

  // --- Call 3: Individual Ch3 (showcase) ---
  try {
    logger.info("generate:ch3_start", { screenshots: ctx.screenshots.length })
    const ch3Prompt = buildChapterPrompt("ch3-showcase", ctx)
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    > = [{ type: "text", text: ch3Prompt }]

    // Attach screenshot previews as base64 images
    for (const ss of ctx.screenshots.slice(0, 3)) {
      if (ss.base64Preview) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: ss.base64Preview,
          },
        })
      }
    }

    const response = await callWorkerModel({
      workload: "website-compose",
      systemPrompt,
      content,
      maxOutputTokens: 8000,
    })
    logger.info("generate:ch3_response", { responseLen: response?.length || 0 })
    const html = extractHtmlFromResponse(response)
    const validation = validateHyperFramesHtml(html, "ch3-showcase", assetFiles, join(captureDir, "assets"))
    if (validation.valid) {
      results.set("ch3-showcase", { id: "ch3-showcase", html, source: "llm" })
      logger.info("generate:chapter_ok", { chapter: "ch3-showcase", source: "llm" })
    } else {
      results.set("ch3-showcase", fallbackToTemplate("ch3-showcase", model, assetFiles, captureDir, validationReason(validation.errors)))
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error("generate:ch3_failed", { error: errMsg })
    results.set("ch3-showcase", fallbackToTemplate("ch3-showcase", model, assetFiles, captureDir, summarizeComposeError(err)))
  }

  // --- Call 4: Individual Ch4 (proof) ---
  try {
    logger.info("generate:ch4_start", { hasStats: model.scenes.some((s) => s.stats?.length), hasLogos: model.logos.length > 0 })
    const ch4Prompt = buildChapterPrompt("ch4-proof", ctx)
    const response = await callWorkerModel({
      workload: "website-compose",
      systemPrompt,
      content: [{ type: "text", text: ch4Prompt }],
      maxOutputTokens: 8000,
    })
    logger.info("generate:ch4_response", { responseLen: response?.length || 0 })
    const html = extractHtmlFromResponse(response)
    const validation = validateHyperFramesHtml(html, "ch4-proof", assetFiles, join(captureDir, "assets"))
    if (validation.valid) {
      results.set("ch4-proof", { id: "ch4-proof", html, source: "llm" })
      logger.info("generate:chapter_ok", { chapter: "ch4-proof", source: "llm" })
    } else {
      results.set("ch4-proof", fallbackToTemplate("ch4-proof", model, assetFiles, captureDir, validationReason(validation.errors)))
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error("generate:ch4_failed", { error: errMsg })
    results.set("ch4-proof", fallbackToTemplate("ch4-proof", model, assetFiles, captureDir, summarizeComposeError(err)))
  }

  // Return in canonical order
  const allIds: ChapterId[] = ["ch1-opening", "ch2-hero", "ch3-showcase", "ch4-proof", "ch5-cta"]
  const results_ = allIds.map((id) => {
    const ch = results.get(id)
    if (ch) return ch
    // Safety net: should not reach here, but fallback just in case
    return fallbackToTemplate(id, model, assetFiles, captureDir, "safety_net_chapter_not_produced")
  })
  logger.info("generate:summary", {
    llm: results_.filter((c) => c.source === "llm").length,
    template: results_.filter((c) => c.source === "template").length,
    details: results_.map((c) => ({ id: c.id, source: c.source })),
  })
  return results_
}

/**
 * Fallback: render a chapter using the template system.
 * Every degradation to template emits exactly one structured warn so the
 * downgrade is observable instead of silently passing as an LLM artifact.
 */
function fallbackToTemplate(
  id: ChapterId,
  model: VideoModel,
  _assetFiles: string[],
  _captureDir: string,
  reason: string,
): ChapterHtml {
  logger.warn("generate:chapter_fallback", { chapter: id, source: "template", reason })
  return { id, html: renderTemplateChapter(id, model), source: "template" }
}

/**
 * Sanitized error summary for fallback logs: a stable category when the
 * failure shape is known, otherwise the truncated first line of the message.
 * Never carries full provider payloads, credentials or prompt content.
 */
export function summarizeComposeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const httpStatus = msg.match(/^StepFun API (\d{3})/)
  if (httpStatus?.[1]) return `stepfun_http_${httpStatus[1]}`
  if (msg.includes("WORKER_AI_GATEWAY_UNCONFIGURED")) return "ai_gateway_unconfigured"
  if (msg.includes("WORKER_AI_GATEWAY_UNAVAILABLE")) return "ai_gateway_unavailable"
  return (msg.split("\n")[0] ?? "").slice(0, 120)
}

/** Compact reason string for validation-driven fallbacks (own validator output, not provider payloads) */
function validationReason(errors: string[]): string {
  return `validation_failed: ${errors.slice(0, 3).join("; ")}`.slice(0, 200)
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
  for (const { src, caption } of shotPaths.slice(0, 5)) {
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
