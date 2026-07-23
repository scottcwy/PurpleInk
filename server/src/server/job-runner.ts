// Job 执行器：把一个 queued Job 跑起来，边跑边更新内存任务表。
// 复用 run-pipeline 的 renderFromCapture / urlToVideo，并通过 onPhase 把阶段回写。
import { isAbsolute, resolve } from "node:path"
import { renderFromCapture, urlToVideo } from "../compose/run-pipeline"
import type { UrlToVideoOptions } from "../compose/run-pipeline"
import { updateJob, type Job, type JobPhase } from "./job-store"
import { logger } from "../lib/logger"

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
}

/** 在后台跑一个 Job（fire-and-forget），异常吞进任务表不外抛。 */
export function runJob(job: Job, req: RenderRequest): void {
  const startedAt = Date.now()
  updateJob(job.id, { status: "running" })

  const onPhase = (phase: string) => {
    updateJob(job.id, { phase: phase as JobPhase })
  }

  const options: UrlToVideoOptions = {
    durationSec: req.duration,
    name: req.name,
    quality: req.quality,
    skipCheck: req.skipCheck,
    ffmpegDir: req.ffmpegDir,
    refresh: req.refresh,
    capture: req.capture,
    onPhase,
  }

  const promise =
    job.kind === "url"
      ? urlToVideo(job.input, options)
      : renderFromCapture(isAbsolute(job.input) ? job.input : resolve(process.cwd(), job.input), options)

  promise
    .then((result) => {
      updateJob(job.id, {
        status: "done",
        phase: "done",
        captureDir: result.captureDir,
        projectDir: result.projectDir,
        videoPath: result.videoPath,
        checkPassed: result.checkPassed,
        durationSec: result.durationSec,
        elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      })
      logger.info("job:done", { id: job.id, videoPath: result.videoPath, checkPassed: result.checkPassed })
    })
    .catch((err) => {
      updateJob(job.id, {
        status: "failed",
        phase: "failed",
        error: String(err?.stack || err),
        elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      })
      logger.error("job:failed", { id: job.id, error: String(err) })
    })
}
