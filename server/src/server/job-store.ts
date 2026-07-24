// 内存任务表：本地开发够用（不引队列/DB）。
// 每个 render 请求起一个后台 Job，前端/curl 轮询 GET /jobs/:id 拿进度与产物。
import { randomUUID } from "node:crypto"

export type JobStatus = "queued" | "running" | "done" | "failed"
/** 阶段：与 run-pipeline 的 onPhase 对齐 */
export type JobPhase = "queued" | "capturing" | "composing" | "rendering" | "verifying" | "done" | "failed"

export interface Job {
  id: string
  /** url = 端到端；capture = 从已有 capture/ 目录渲染 */
  kind: "url" | "capture"
  /** 原始输入（URL 或 captureDir） */
  input: string
  status: JobStatus
  phase: JobPhase
  createdAt: number
  updatedAt: number
  /** 渲染耗时秒（done 时写入） */
  elapsedSec?: number
  captureDir?: string
  projectDir?: string
  videoPath?: string | null
  checkPassed?: boolean
  durationSec?: number
  goldenVerified?: boolean
  goldenDetails?: string[]
  error?: string
  /** 最近若干条阶段日志（含时间戳），便于前端展示 */
  logs: { at: number; msg: string }[]
}

const jobs = new Map<string, Job>()

export function createJob(kind: Job["kind"], input: string): Job {
  const now = Date.now()
  const job: Job = {
    id: randomUUID(),
    kind,
    input,
    status: "queued",
    phase: "queued",
    createdAt: now,
    updatedAt: now,
    logs: [{ at: now, msg: "queued" }],
  }
  jobs.set(job.id, job)
  return job
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
}

/** 就地更新 Job 字段并刷新时间戳；phase 变化会追加一条日志 */
export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  if (patch.phase && patch.phase !== job.phase) {
    job.logs.push({ at: Date.now(), msg: `phase: ${patch.phase}` })
  }
  Object.assign(job, patch)
  job.updatedAt = Date.now()
  return job
}

/** 对外精简视图（不回传本机绝对路径以外的敏感内容；这里本地开发直接回传） */
export function toPublicJob(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    input: job.input,
    status: job.status,
    phase: job.phase,
    checkPassed: job.checkPassed,
    durationSec: job.durationSec,
    elapsedSec: job.elapsedSec,
    goldenVerified: job.goldenVerified,
    goldenDetails: job.goldenDetails,
    hasVideo: Boolean(job.videoPath),
    videoUrl: job.videoPath ? `/jobs/${job.id}/video` : null,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    logs: job.logs,
  }
}
