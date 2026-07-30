import 'server-only'
import { z } from 'zod'
import {
  WebsiteEngineError,
  type StartWebsiteEngineInput,
  type WebsiteEngineClient,
  type WebsiteEngineJob,
} from './engine-client'
import {
  safeWebsiteStageProgress,
  type WebsiteExecutionFailureCode,
  type WebsiteStageProgress,
} from './website-stage-contract'

export const WEBSITE_EXECUTION_TIMEOUT_MS = 45 * 60 * 1_000
export const WEBSITE_POLL_INTERVAL_MS = 2_000

const uuidSchema = z.string().uuid()

export interface WebsiteEngineExecutionInput {
  projectId: string
  attemptId: string
  url: string
  name: string
  durationSec: number
  quality: 'draft' | 'standard' | 'high'
}

export interface WebsiteEngineExecutionResult {
  requestId: string
  job: WebsiteEngineJob
  videoBytes: Buffer
}

export interface WebsiteEngineExecutionDependencies {
  engine: Pick<WebsiteEngineClient, 'start' | 'getJob' | 'downloadVideo'>
    & Partial<Pick<WebsiteEngineClient, 'cancel'>>
  onProgress(progress: WebsiteStageProgress): Promise<void>
  nowMs: () => number
  sleep(milliseconds: number): Promise<void>
  pollIntervalMs: number
  timeoutMs: number
  signal?: AbortSignal
}

export class WebsiteExecutionError extends Error {
  constructor(readonly code: WebsiteExecutionFailureCode) {
    super(code)
    this.name = 'WebsiteExecutionError'
  }
}

export function createWebsiteEngineRequestId(
  projectIdInput: string,
  attemptIdInput: string,
): string {
  const projectId = uuidSchema.parse(projectIdInput)
  const attemptId = uuidSchema.parse(attemptIdInput)
  return `website:${projectId}:${attemptId}`
}

export async function executeWebsiteEngine(
  input: WebsiteEngineExecutionInput,
  dependencies: WebsiteEngineExecutionDependencies,
): Promise<WebsiteEngineExecutionResult> {
  const requestId = createWebsiteEngineRequestId(input.projectId, input.attemptId)
  dependencies.signal?.throwIfAborted()
  const startInput: StartWebsiteEngineInput = {
    requestId,
    url: input.url,
    name: input.name,
    durationSec: input.durationSec,
    quality: input.quality,
  }
  const timeoutMs = Math.min(
    Math.max(1, dependencies.timeoutMs),
    WEBSITE_EXECUTION_TIMEOUT_MS,
  )
  const pollIntervalMs = Math.max(1, dependencies.pollIntervalMs)
  const deadline = dependencies.nowMs() + timeoutMs
  let restarted = false
  let job = await withinDeadline(
    () => startChecked(dependencies.engine, startInput),
    deadline,
    dependencies.nowMs,
  )
  const cancelWorker = () => {
    void dependencies.engine.cancel?.(job.id).catch(() => undefined)
  }
  dependencies.signal?.addEventListener('abort', cancelWorker, { once: true })

  try {
    while (true) {
      dependencies.signal?.throwIfAborted()
      if (
        job.status === 'failed'
        || job.phase === 'failed'
        || job.status === 'cancelled'
        || job.phase === 'cancelled'
      ) {
        throw new WebsiteExecutionError('WEBSITE_ENGINE_FAILED')
      }
      await dependencies.onProgress(safeWebsiteStageProgress(job))
      if (job.status === 'done') {
        assertCompletedJob(job)
        return {
          requestId,
          job,
          videoBytes: await withinDeadline(
            () => dependencies.engine.downloadVideo(job.id),
            deadline,
            dependencies.nowMs,
          ),
        }
      }
      const remainingMs = deadline - dependencies.nowMs()
      if (remainingMs <= 0) {
        throw new WebsiteExecutionError('WEBSITE_ENGINE_TIMEOUT')
      }
      await dependencies.sleep(Math.min(pollIntervalMs, remainingMs))
      dependencies.signal?.throwIfAborted()
      if (dependencies.nowMs() >= deadline) {
        throw new WebsiteExecutionError('WEBSITE_ENGINE_TIMEOUT')
      }
      try {
        job = await withinDeadline(
          () => dependencies.engine.getJob(job.id),
          deadline,
          dependencies.nowMs,
        )
        assertRequestIdentity(job, requestId)
      } catch (error) {
        if (!isMissingJob(error) || restarted) throw error
        restarted = true
        job = await withinDeadline(
          () => startChecked(dependencies.engine, startInput),
          deadline,
          dependencies.nowMs,
        )
      }
    }
  } finally {
    dependencies.signal?.removeEventListener('abort', cancelWorker)
  }
}

export function websiteFailureCode(error: unknown): WebsiteExecutionFailureCode {
  if (error instanceof WebsiteExecutionError) return error.code
  if (!(error instanceof WebsiteEngineError)) return 'WEBSITE_EXECUTION_FAILED'
  if (error.code === 'ENGINE_VIDEO_INVALID') return 'WEBSITE_VIDEO_INVALID'
  if (error.code === 'ENGINE_RESPONSE_INVALID') {
    return 'WEBSITE_ENGINE_RESPONSE_INVALID'
  }
  return 'WEBSITE_ENGINE_UNAVAILABLE'
}

async function startChecked(
  engine: WebsiteEngineExecutionDependencies['engine'],
  input: StartWebsiteEngineInput,
): Promise<WebsiteEngineJob> {
  const response = await engine.start(input)
  assertRequestIdentity(response.job, input.requestId)
  return response.job
}

async function withinDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
  nowMs: () => number,
): Promise<T> {
  const remainingMs = deadline - nowMs()
  if (remainingMs <= 0) {
    throw new WebsiteExecutionError('WEBSITE_ENGINE_TIMEOUT')
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new WebsiteExecutionError('WEBSITE_ENGINE_TIMEOUT')),
      remainingMs,
    )
  })
  try {
    return await Promise.race([operation(), timeout])
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

function assertRequestIdentity(job: WebsiteEngineJob, requestId: string): void {
  if (job.requestId !== requestId) {
    throw new WebsiteExecutionError('WEBSITE_ENGINE_RESPONSE_INVALID')
  }
}

function assertCompletedJob(job: WebsiteEngineJob): void {
  if (
    job.phase !== 'done'
    || !job.hasVideo
    || job.durationSource !== 'output'
    || job.durationSec === null
    || job.checkPassed === null
    || job.goldenVerified === null
  ) {
    throw new WebsiteExecutionError('WEBSITE_ENGINE_RESPONSE_INVALID')
  }
}

function isMissingJob(error: unknown): boolean {
  return error instanceof WebsiteEngineError
    && error.code === 'ENGINE_JOB_NOT_FOUND'
}
