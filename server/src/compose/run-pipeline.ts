// 编排层：把 compose 的各步串起来。
// - renderFromCapture: 已有 capture/ 目录 → video.mp4
// - urlToVideo:        URL → (M3 采集) → capture/ → video.mp4（端到端）
import { join } from "node:path"
import { access, readdir, rm } from "node:fs/promises"
import { buildVideoModel } from "./model"
import { writeProject } from "./project"
import { renderProject, type RenderOptions } from "./render"
import { runCapture, type RunCaptureOptions } from "../capture/run-capture"
import { logger } from "../lib/logger"

export interface PipelineResult {
  captureDir: string
  projectDir: string
  videoPath: string | null
  checkPassed: boolean
  durationSec: number
}

export interface RenderFromCaptureOptions extends RenderOptions {
  /** 项目输出目录（默认 <captureDir>/../<id>-video） */
  projectDir?: string
  /** 目标时长秒（默认 30） */
  durationSec?: number
  /** 覆盖展示名 */
  name?: string
  /** 进度回调：在各阶段边界上报 phase（queued/capturing/composing/rendering/done） */
  onPhase?: (phase: string) => void
}

/** 从一个 capture/ 目录生成 video.mp4 */
export async function renderFromCapture(
  captureDir: string,
  options: RenderFromCaptureOptions = {}
): Promise<PipelineResult> {
  options.onPhase?.("composing")
  const model = await buildVideoModel(captureDir, { durationSec: options.durationSec, name: options.name })
  logger.info("pipeline:model_built", {
    scenes: model.scenes.length,
    durationSec: model.durationSec,
    palette: model.palette,
  })

  const projectDir = options.projectDir || join(captureDir, "..", `${model.id}-video`)
  const written = await writeProject(model, projectDir, captureDir)
  logger.info("pipeline:project_written", { projectDir: written.projectDir, assets: written.assetCount })

  options.onPhase?.("rendering")
  const rendered = await renderProject(written.projectDir, options)
  if (!rendered.videoPath) {
    logger.error("pipeline:no_video", { renderTail: rendered.renderOutput.slice(-800) })
  }

  return {
    captureDir,
    projectDir: written.projectDir,
    videoPath: rendered.videoPath,
    checkPassed: rendered.checkPassed,
    durationSec: model.durationSec,
  }
}

export interface UrlToVideoOptions extends RenderFromCaptureOptions {
  /** 采集阶段选项（driver/账号/截图上下限等） */
  capture?: RunCaptureOptions
  /** 采集缓存根目录（默认 <cwd>/out/cache）；同一 URL 复用已采集的 capture/，跳过整段采集 */
  cacheRoot?: string
  /** 强制重新采集，忽略缓存（站点更新后用） */
  refresh?: boolean
}

/**
 * URL → 采集 → 适配器 → capture/ → video.mp4（端到端）。
 * 采集结果按 URL 缓存：命中则跳过 ~百秒的采集直接进渲染；refresh=true 强制重采。
 * 注意：缓存只省「采集」，画质仍由后续渲染的 quality 决定，不受影响。
 */
export async function urlToVideo(url: string, options: UrlToVideoOptions = {}): Promise<PipelineResult> {
  const cacheRoot = options.cacheRoot || join(process.cwd(), "out", "cache")
  const cacheDir = join(cacheRoot, slugFromUrl(url))

  // 命中缓存：直接复用已采集的 capture/，跳过采集阶段。
  if (!options.refresh && (await isUsableCapture(cacheDir))) {
    logger.info("pipeline:capture_cache_hit", { url, cacheDir })
    options.onPhase?.("capturing") // 短暂经过该阶段，前端进度提示保持一致
    return renderFromCapture(cacheDir, options)
  }

  // 未命中/强制刷新：清掉旧缓存再重采，避免残留旧资产污染模型。
  await rm(cacheDir, { recursive: true, force: true }).catch(() => {})
  options.onPhase?.("capturing")
  logger.info("pipeline:capture_start", { url, cacheDir })
  const manifest = await runCapture(url, { ...options.capture, outDir: options.capture?.outDir ?? cacheDir })
  logger.info("pipeline:capture_done", { captureDir: manifest.outDir, assets: manifest.assets.length })
  return renderFromCapture(manifest.outDir, options)
}

/** 判断目录是否为可复用的 capture/：有 meta.json 且 assets 下至少一张截图 */
async function isUsableCapture(dir: string): Promise<boolean> {
  try {
    await access(join(dir, "meta.json"))
    const files = await readdir(join(dir, "assets"))
    return files.some((f) => /\.(png|jpe?g|webp)$/i.test(f))
  } catch {
    return false
  }
}

/** 从 URL 主机名 + 路径派生稳定 slug 作为缓存目录名（区分同站不同页） */
function slugFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const raw = `${u.hostname.replace(/^www\./, "")}${u.pathname}`
    return raw.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "capture"
  } catch {
    return "capture"
  }
}
