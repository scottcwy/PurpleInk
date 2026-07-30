import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { assertBillingAvailable } from '@/features/billing'
import type { WorkflowFault } from '@/features/canvas'
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

export const WEBSITE_BILLING_INVOCATION_NO = 1
const WEBSITE_TERMINAL_MESSAGE =
  '网站介绍视频本次执行已安全终止。为避免重复渲染和重复计费，系统不会隐式新建重试；可从项目重新启动一次新操作。'

/**
 * 网站复合服务一次失败后，计费账本会按未知用量结算原预留。通用队列若再生成
 * 新 attempt 会启动第二次渲染和第二笔预留，因此这里显式禁止隐式自动重试；
 * worker 丢失已在同 attempt 内用稳定 requestId 恢复，重新生产需显式新建操作。
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
      invocationNo: WEBSITE_BILLING_INVOCATION_NO,
      ...(job.signal ? { signal: job.signal } : {}),
    })
    job.signal?.throwIfAborted()
  } catch (error) {
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
  preflight: () => Promise<void> = assertBillingAvailable,
  database?: Db,
): Promise<QueueEnqueueReceipt> {
  const payload = websiteVideoJobSchema.parse(input)
  return enqueueWebsiteVideoOnce(
    payload,
    targetQueue,
    preflight,
    database ?? (await getDb()),
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
        inArray(taskAttempts.status, ['queued', 'running', 'succeeded']),
      ))
      .limit(1)
    if (attempt) {
      return {
        attemptId: attempt.id,
        status: z.enum(['queued', 'running', 'succeeded']).parse(attempt.status),
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
