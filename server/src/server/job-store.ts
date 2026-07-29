// 内存任务表：本地开发够用（不引队列/DB）。
// 每个 render 请求起一个后台 Job，前端/curl 轮询 GET /jobs/:id 拿进度与产物。
import { randomUUID } from "node:crypto"

export type JobStatus = "queued" | "running" | "done" | "failed"
/** 阶段：与 run-pipeline 的 onPhase 对齐 */
export type JobPhase =
  | "queued"
  | "capturing"
  | "scripting"
  | "synthesizing"
  | "timing"
  | "composing"
  | "rendering"
  | "verifying"
  | "muxing"
  | "done"
  | "failed"

export interface Job {
  id: string
  /** 由 Products 工作流受控创建；legacy /render 始终为 false。 */
  integrated: boolean
  /** Products 侧稳定幂等键，仅 integrated Job 存在。 */
  requestId?: string
  requestFingerprint?: string
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
const integratedRequests = new Map<string, string>()

export function createJob(kind: Job["kind"], input: string): Job {
  const now = Date.now()
  const job: Job = {
    id: randomUUID(),
    integrated: false,
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

export type IntegratedJobCreateResult = {
  kind: "created" | "reused" | "conflict"
  job: Job
}

/**
 * requestId 是集成 API 的幂等边界。相同规范输入复用；同 key 不同输入明确冲突，
 * 绝不悄悄覆盖或再起一个昂贵渲染任务。
 */
export function createIntegratedJob(
  input: string,
  requestId: string,
  requestFingerprint: string
): IntegratedJobCreateResult {
  const existingId = integratedRequests.get(requestId)
  const existing = existingId ? jobs.get(existingId) : undefined
  if (existing) {
    const sameInput =
      existing.input === input && existing.requestFingerprint === requestFingerprint
    return { kind: sameInput ? "reused" : "conflict", job: existing }
  }

  const job = createJob("url", input)
  job.integrated = true
  job.requestId = requestId
  job.requestFingerprint = requestFingerprint
  integratedRequests.set(requestId, job.id)
  return { kind: "created", job }
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

/** 受控集成视图：不含 query、原始错误/日志、本机路径或输入正文。 */
export function toIntegratedJobView(job: Job) {
  const origin = new URL(job.input).origin
  return {
    id: job.id,
    requestId: job.requestId,
    origin,
    status: job.status,
    phase: job.phase,
    durationSec: job.durationSec ?? null,
    elapsedSec: job.elapsedSec ?? null,
    checkPassed: job.checkPassed ?? null,
    goldenVerified: job.goldenVerified ?? null,
    goldenCheckCount: job.goldenDetails?.length ?? 0,
    hasVideo: Boolean(job.videoPath),
    videoUrl: job.videoPath ? `/internal/jobs/${encodeURIComponent(job.id)}/video` : null,
    failure: job.status === "failed" ? { code: "ENGINE_JOB_FAILED" } : null,
  }
}
