// Job 执行器：把一个 queued Job 跑起来，边跑边更新内存任务表。
// 复用 run-pipeline 的 renderFromCapture / urlToVideo，并通过 onPhase 把阶段回写。
import { isAbsolute, resolve } from "node:path"
import { renderFromCapture, urlToVideo } from "../compose/run-pipeline"
import type { UrlToVideoOptions } from "../compose/run-pipeline"
import { getJob, updateJob, type Job, type JobPhase } from "./job-store"
import { logger } from "../lib/logger"
import { errorMessage } from "../lib/error-message"

const controllers = new Map<string, AbortController>()

/** POST /render 的请求体（url 与 captureDir 二选一） */
export interface RenderRequest {
  url?: string
  captureDir?: string
  duration?: number
  name?: string
  quality?: string
  skipCheck?: boolean
  ffmpegDir?: string
  /** URL 模式：强制重新采集，忽略按 URL 的采集缓存（站点更新后用） */
  refresh?: boolean
  /** URL 模式透传给采集层 */
  capture?: UrlToVideoOptions["capture"]
  /** 渲染帧率 */
  fps?: number
  /** 生成模式：llm / template / auto */
  generation?: "llm" | "template" | "auto"
}

/** 在后台跑一个 Job（fire-and-forget），异常吞进任务表不外抛。 */
export function runJob(job: Job, req: RenderRequest): void {
  const startedAt = Date.now()
  const controller = new AbortController()
  controllers.set(job.id, controller)
  updateJob(job.id, { status: "running" })

  const onPhase = (phase: string) => {
    updateJob(job.id, { phase: phase as JobPhase })
  }

  const capture = job.integrated
    ? { ...req.capture, credentialMode: "none" as const, publicOnly: true }
    : req.capture
  const options: UrlToVideoOptions = {
    ...(req.duration != null ? { durationSec: req.duration } : {}),
    ...(req.name != null ? { name: req.name } : {}),
    ...(req.quality != null ? { quality: req.quality } : {}),
    ...(req.skipCheck != null ? { skipCheck: req.skipCheck } : {}),
    ...(req.ffmpegDir != null ? { ffmpegDir: req.ffmpegDir } : {}),
    ...(req.refresh != null ? { refresh: req.refresh } : {}),
    ...(capture != null ? { capture } : {}),
    ...(req.fps != null ? { fps: req.fps } : {}),
    ...(req.generation != null ? { generation: req.generation } : {}),
    ...(job.integrated && job.requestId
      ? { integratedRequestId: job.requestId }
      : {}),
    onPhase,
    signal: controller.signal,
  }

  const promise =
    job.kind === "url"
      ? urlToVideo(job.input, options)
      : renderFromCapture(isAbsolute(job.input) ? job.input : resolve(process.cwd(), job.input), options)

  promise
    .then((result) => {
      if (controller.signal.aborted) return
      updateJob(job.id, {
        status: "done",
        phase: "done",
        captureDir: result.captureDir,
        projectDir: result.projectDir,
        videoPath: result.videoPath,
        checkPassed: result.checkPassed,
        durationSec: result.durationSec,
        goldenVerified: result.goldenVerified,
        goldenDetails: result.goldenDetails,
        elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      })
      logger.info("job:done", { id: job.id, videoPath: result.videoPath, checkPassed: result.checkPassed })
    })
    .catch((err) => {
      if (controller.signal.aborted) {
        updateJob(job.id, {
          status: "cancelled",
          phase: "cancelled",
          error: undefined,
          elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        })
        logger.info("job:cancelled", { id: job.id })
        return
      }
      updateJob(job.id, {
        status: "failed",
        phase: "failed",
        error: errorMessage(err),
        elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      })
      // 对外只留 message；完整栈只进服务端日志，便于排障又不外泄本机路径。
      logger.error("job:failed", { id: job.id, stack: String(err?.stack || err) })
    })
    .finally(() => {
      controllers.delete(job.id)
    })
}

export function cancelJob(jobId: string): boolean {
  const job = getJob(jobId)
  if (!job || !job.integrated) return false
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return true
  }
  updateJob(jobId, { status: "cancelled", phase: "cancelled" })
  controllers.get(jobId)?.abort(new Error("PROJECT_EXECUTION_CANCELLED"))
  return true
}
