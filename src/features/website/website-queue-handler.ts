import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { QuotaExhaustedError } from '@/features/billing'
import type { WorkflowFault } from '@/features/canvas'
import { PostgresProjectSourceRepository } from '@/features/projects'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { taskAttempts } from '@/lib/db/schema'
import {
  queue as defaultQueue,
  type QueueAdapter,
  type QueueEnqueueReceipt,
  type QueueJob,
} from '@/lib/queue'
import { queueFingerprint } from '@/lib/queue/attempt-checkpoint'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import {
  runWebsiteVideo,
  type RunWebsiteVideoInput,
} from './website-execution'
import {
  websiteFailureCode,
} from './website-engine-execution'
import type { WebsiteExecutionFailureCode } from './website-stage-contract'

const websiteVideoJobSchema = z
  .object({
    projectId: z.string().uuid(),
    workflowVersion: z.literal(activeWorkflowVersionFor('website')),
  })
  .strict()

export type WebsiteVideoJobInput = z.infer<typeof websiteVideoJobSchema>

const WEBSITE_TERMINAL_MESSAGE =
  '网站介绍视频本次执行已安全终止。为避免重复模型调用与重复扣费，系统不会隐式新建重试；可从项目重新启动一次新操作。'

/**
 * Worker 内每个真实模型请求已经单独入账。通用队列若隐式生成新 attempt，
 * 会重新执行已完成的调用，因此这里显式禁止自动重试；重新生产需由用户发起
 * 一个新的、可审计的操作。
 */
export class WebsiteVideoAttemptTerminalError extends Error implements WorkflowFault {
  [key: string]: unknown

  override readonly name = 'WebsiteVideoAttemptTerminalError'
  readonly schemaVersion = 2 as const
  readonly code = 'STAGE_FAILED' as const
  readonly origin = 'platform' as const
  readonly stage = 'WEBSITE'
  readonly title = '网站介绍视频已停止'
  readonly retryable = false
  readonly recovery = 'manual_retry' as const
  readonly referenceId = globalThis.crypto.randomUUID()
  readonly occurredAt = new Date().toISOString()

  constructor(readonly failureCode: WebsiteExecutionFailureCode) {
    super(WEBSITE_TERMINAL_MESSAGE)
    Object.defineProperty(this, 'message', {
      value: WEBSITE_TERMINAL_MESSAGE,
      enumerable: true,
    })
  }
}

export async function runWebsiteVideoQueueJob(
  job: QueueJob,
  run: (input: RunWebsiteVideoInput) => Promise<unknown> = runWebsiteVideo,
): Promise<void> {
  const payload = websiteVideoJobSchema.parse(job.payload)
  job.signal?.throwIfAborted()
  try {
    await run({
      workspaceId: z.string().uuid().parse(job.workspaceId),
      projectId: payload.projectId,
      attemptId: z.string().uuid().parse(job.id),
      ...(job.signal ? { signal: job.signal } : {}),
    })
    job.signal?.throwIfAborted()
  } catch (error) {
    if (error instanceof QuotaExhaustedError) throw error
    throw new WebsiteVideoAttemptTerminalError(websiteFailureCode(error))
  }
}

export function registerWebsiteVideoHandler(
  targetQueue: QueueAdapter = defaultQueue,
  run: (input: RunWebsiteVideoInput) => Promise<unknown> = runWebsiteVideo,
): void {
  targetQueue.register('website-video', async (job) => {
    await runWebsiteVideoQueueJob(job, run)
  })
}

export async function enqueueWebsiteVideo(
  input: WebsiteVideoJobInput,
  targetQueue: QueueAdapter = defaultQueue,
  preflight?: () => Promise<void>,
  database?: Db,
): Promise<QueueEnqueueReceipt> {
  const payload = websiteVideoJobSchema.parse(input)
  const resolvedDatabase = database ?? (await getDb())
  return enqueueWebsiteVideoOnce(
    payload,
    targetQueue,
    preflight ?? (() => preflightWebsiteCapacity(
      payload.projectId,
      resolvedDatabase,
    )),
    resolvedDatabase,
  )
}

async function enqueueWebsiteVideoOnce(
  payload: WebsiteVideoJobInput,
  targetQueue: QueueAdapter,
  preflight: () => Promise<void>,
  database: Db,
): Promise<QueueEnqueueReceipt> {
  const fingerprint = queueFingerprint('website-video', payload)
  return database.transaction(async (transaction) => {
    const lockKey = `website-video:${payload.projectId}:${fingerprint}`
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    )
    const [attempt] = await transaction
      .select({ id: taskAttempts.id, status: taskAttempts.status })
      .from(taskAttempts)
      .where(and(
        eq(taskAttempts.workspaceId, currentWorkspaceId()),
        eq(taskAttempts.entityType, 'project'),
        eq(taskAttempts.entityId, payload.projectId),
        eq(taskAttempts.fingerprint, fingerprint),
        inArray(taskAttempts.status, ['queued', 'running']),
      ))
      .limit(1)
    if (attempt) {
      return {
        attemptId: attempt.id,
        status: z.enum(['queued', 'running']).parse(attempt.status),
        reused: true,
      }
    }
    await preflight()
    return {
      attemptId: await targetQueue.enqueue('website-video', payload, {
        projectId: payload.projectId,
        workflowVersion: payload.workflowVersion,
      }),
      status: 'queued',
      reused: false,
    }
  })
}

async function preflightWebsiteCapacity(
  projectId: string,
  database: Db,
): Promise<void> {
  const source = await new PostgresProjectSourceRepository(
    database,
    currentWorkspaceId(),
  ).get(projectId)
  if (!source || source.sourcePayload.kind !== 'website') {
    throw new Error('WEBSITE_PROJECT_INVALID')
  }
}
