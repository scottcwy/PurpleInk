import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { runInAuthContext, SYSTEM_USER_ID } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import { pipelineRuns, taskAttempts, type VersionedPayload } from '@/lib/db/schema/index'
import { backoffMs, shouldAutoRetry } from './retry-policy'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'
import type { WorkflowExecutionNotice, WorkflowFault } from '@/features/canvas/workflow-fault'

export const MAX_PROVIDER_WAIT_MS = 15 * 60_000
const FALLBACK_PROVIDER_WAIT_MS = 15_000

interface CompletingAttemptRow {
  runId: string
  taskId: string
  entityType: string
  entityId: string
  status: string
  attemptNo: number
  fingerprint: string
  checkpoint: VersionedPayload
}

/**
 * 收尾一次 attempt 执行（从 in-process-queue 抽出）。
 *
 * 失败且值得自动重试（classifyWorkflowError retryable 且未超上限）时不终态化：
 * 原 attempt 置 superseded（failure 照记），同 run 追加 attemptNo+1 的 queued
 * attempt，visibleAt 用 DB 时钟推到退避之后；run 回到 queued，不标 failed。
 * 其余情况维持原语义：attempt 与 run 同置终态。调用方可用
 * allowAutoRetry=false 对重试无法自愈的失败（如进程内未注册 handler）强制终态。
 */
export async function completeAttempt(
  database: Db,
  workspaceId: string,
  attemptId: string,
  status: 'succeeded' | 'failed',
  failure?: unknown,
  options?: { allowAutoRetry?: boolean }
): Promise<void> {
  const outcome = await database.transaction(async (transaction) => {
    const [attempt]: CompletingAttemptRow[] = await transaction
      .select({
        runId: taskAttempts.runId,
        taskId: taskAttempts.taskId,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
        status: taskAttempts.status,
        attemptNo: taskAttempts.attemptNo,
        fingerprint: taskAttempts.fingerprint,
        checkpoint: taskAttempts.checkpoint,
      })
      .from(taskAttempts)
      .where(
        and(
          eq(taskAttempts.workspaceId, workspaceId),
          eq(taskAttempts.id, attemptId)
        )
      )
      .limit(1)
      .for('update')
    if (!attempt) throw new Error(`legacy queue attempt not found: ${attemptId}`)
    // sweepExpiredLeases 可能在 handler 迟到完成前已把 attempt/run 收尸为失败。
    // 行锁保证这里读取的状态与后续写入属于同一原子窗口；非 running 的旧完成
    // 不得覆盖 TASK_INTERRUPTED 投影，也不得重置节点或追加新的 retry attempt。
    if (attempt.status !== 'running') return null

    const stage = retryStage(attempt.checkpoint)
    const fault = failure === undefined ? null : workflowFault(failure, stage)
    if (
      status === 'failed'
      && fault?.code === 'PROVIDER_RATE_LIMITED'
      && (options?.allowAutoRetry ?? true)
      && providerWaitRemaining(attempt.checkpoint)
    ) {
      const resumeAt = boundedResumeAt(fault, attempt.checkpoint)
      await scheduleDeferred(
        transaction,
        workspaceId,
        attemptId,
        attempt,
        fault,
        resumeAt,
      )
      return attempt.entityType === 'node'
        ? {
            nodeId: attempt.entityId,
            notice: {
              code: 'PROVIDER_RATE_LIMITED' as const,
              message: `${fault.provider?.label ?? '第三方服务'}当前请求较多，系统已自动排队`,
              resumeAt: resumeAt.toISOString(),
              providerLabel: fault.provider?.label ?? '第三方服务',
            },
          }
        : null
    }
    const retryable =
      status === 'failed' &&
      failure !== undefined &&
      fault?.code !== 'PROVIDER_RATE_LIMITED' &&
      (options?.allowAutoRetry ?? true) &&
      shouldAutoRetry(
        failure,
        ordinaryAttemptNo(attempt),
        stage,
      )
    if (retryable) {
      await scheduleRetry(
        transaction,
        workspaceId,
        attemptId,
        attempt,
        fault ?? workflowFault(failure, stage),
      )
      return attempt.entityType === 'node' ? { nodeId: attempt.entityId } : null
    }

    await transaction
      .update(taskAttempts)
      .set({
        status,
        failure: failure === undefined
          ? null
          : fault ?? workflowFault(failure, stage),
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(taskAttempts.workspaceId, workspaceId),
          eq(taskAttempts.id, attemptId)
        )
      )
    await transaction
      .update(pipelineRuns)
      .set({ status, completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(pipelineRuns.workspaceId, workspaceId),
          eq(pipelineRuns.id, attempt.runId)
        )
      )
    return null
  })
  if (outcome) {
    await resetNodeForRetry(workspaceId, outcome.nodeId, outcome.notice)
  }
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/** 原 attempt 置 superseded，同 run 插入退避后的重试 attempt；run 回 queued。 */
async function scheduleRetry(
  transaction: Transaction,
  workspaceId: string,
  attemptId: string,
  attempt: CompletingAttemptRow,
  failure: VersionedPayload
): Promise<void> {
  await transaction
    .update(taskAttempts)
    .set({
      status: 'superseded',
      failure,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(taskAttempts.id, attemptId),
        eq(taskAttempts.status, 'running')
      )
    )
  await transaction.insert(taskAttempts).values({
    workspaceId,
    id: randomUUID(),
    runId: attempt.runId,
    taskId: attempt.taskId,
    entityType: attempt.entityType,
    entityId: attempt.entityId,
    // 唯一约束 (ws, runId, taskId, entityType, entityId, attemptNo) 天然防重。
    attemptNo: attempt.attemptNo + 1,
    status: 'queued',
    fingerprint: attempt.fingerprint,
    checkpoint: patchQueueMeta(attempt.checkpoint, {
      ordinaryAttemptNo: ordinaryAttemptNo(attempt) + 1,
    }),
    // 用 DB 时钟计算退避，避免应用与 DB 时钟漂移（与 leaseDeadline 同理）。
    visibleAt: sql`now() + make_interval(secs => ${backoffMs(attempt.attemptNo) / 1000})`,
  })
  await transaction
    .update(pipelineRuns)
    .set({ status: 'queued', updatedAt: sql`now()` })
    .where(
      and(
        eq(pipelineRuns.workspaceId, workspaceId),
        eq(pipelineRuns.id, attempt.runId)
      )
    )
}

function workflowFault(failure: unknown, stage: string): WorkflowFault {
  return classifyWorkflowError(
    typeof failure === 'string' ? new Error(failure) : failure,
    { stage }
  )
}

async function scheduleDeferred(
  transaction: Transaction,
  workspaceId: string,
  attemptId: string,
  attempt: CompletingAttemptRow,
  fault: WorkflowFault,
  resumeAt: Date,
): Promise<void> {
  await transaction
    .update(taskAttempts)
    .set({
      status: 'superseded',
      failure: fault,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(taskAttempts.workspaceId, workspaceId),
      eq(taskAttempts.id, attemptId),
      eq(taskAttempts.status, 'running'),
    ))
  await transaction.insert(taskAttempts).values({
    workspaceId,
    id: randomUUID(),
    runId: attempt.runId,
    taskId: attempt.taskId,
    entityType: attempt.entityType,
    entityId: attempt.entityId,
    attemptNo: attempt.attemptNo + 1,
    status: 'queued',
    fingerprint: attempt.fingerprint,
    checkpoint: patchQueueMeta(attempt.checkpoint, {
      ordinaryAttemptNo: ordinaryAttemptNo(attempt),
      providerWaitStartedAt: providerWaitStartedAt(attempt.checkpoint).toISOString(),
    }),
    visibleAt: resumeAt,
  })
  await transaction
    .update(pipelineRuns)
    .set({ status: 'queued', completedAt: null, updatedAt: sql`now()` })
    .where(and(
      eq(pipelineRuns.workspaceId, workspaceId),
      eq(pipelineRuns.id, attempt.runId),
    ))
}

/**
 * 自动重试前把节点复位到 pending：两个 handler 开场都走 pending -> running，
 * 而首次失败的补偿已把节点置 failed（failed -> running 非法）。features 依赖
 * 按 lease.ts 的先例动态加载；复位失败只记日志，不阻断重试排队本身。
 */
async function resetNodeForRetry(
  workspaceId: string,
  nodeId: string,
  notice?: WorkflowExecutionNotice,
): Promise<void> {
  try {
    const { transitionNodeStatus } = await import('@/features/canvas/status')
    await runInAuthContext({ workspaceId, userId: SYSTEM_USER_ID }, () =>
      transitionNodeStatus(nodeId, 'pending', notice ? { executionNotice: notice } : undefined)
    )
  } catch (error) {
    // 节点可能已被用户/其他路径改走（如仍在 running），容错不阻断。
    console.error('[queue] 自动重试的节点复位失败', { nodeId, error })
  }
}

function ordinaryAttemptNo(attempt: CompletingAttemptRow): number {
  const meta = queueMeta(attempt.checkpoint)
  return typeof meta.ordinaryAttemptNo === 'number'
    ? meta.ordinaryAttemptNo
    : attempt.attemptNo
}

function providerWaitRemaining(checkpoint: VersionedPayload): boolean {
  return Date.now() - providerWaitStartedAt(checkpoint).getTime() < MAX_PROVIDER_WAIT_MS
}

function boundedResumeAt(fault: WorkflowFault, checkpoint: VersionedPayload): Date {
  const startedAt = providerWaitStartedAt(checkpoint)
  const deadline = startedAt.getTime() + MAX_PROVIDER_WAIT_MS
  const projected = fault.provider?.retryAt
    ? Date.parse(fault.provider.retryAt)
    : Date.now() + FALLBACK_PROVIDER_WAIT_MS
  const valid = Number.isFinite(projected) ? projected : Date.now() + FALLBACK_PROVIDER_WAIT_MS
  return new Date(Math.min(Math.max(valid, Date.now()), deadline))
}

function providerWaitStartedAt(checkpoint: VersionedPayload): Date {
  const value = queueMeta(checkpoint).providerWaitStartedAt
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return new Date(timestamp)
  }
  return new Date()
}

function queueMeta(checkpoint: VersionedPayload): Record<string, unknown> {
  const value = checkpoint.queueMeta
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function patchQueueMeta(
  checkpoint: VersionedPayload,
  patch: Record<string, unknown>
): VersionedPayload {
  return { ...checkpoint, queueMeta: { ...queueMeta(checkpoint), ...patch } }
}

/** shouldAutoRetry 的兜底 stage：director 作业取 payload.stage，渲染作业归 RENDER。 */
function retryStage(checkpoint: unknown): string {
  if (!checkpoint || typeof checkpoint !== 'object') return 'QUEUE'
  const record = checkpoint as Record<string, unknown>
  if (record.kind === 'render-shot') return 'RENDER'
  const payload = record.payload
  if (payload && typeof payload === 'object') {
    const stage = (payload as Record<string, unknown>).stage
    if (typeof stage === 'string') return stage
  }
  return 'QUEUE'
}
