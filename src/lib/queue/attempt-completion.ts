import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { runInAuthContext, SYSTEM_USER_ID } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import { pipelineRuns, taskAttempts, type VersionedPayload } from '@/lib/db/schema/index'
import { backoffMs, shouldAutoRetry } from './retry-policy'

interface CompletingAttemptRow {
  runId: string
  taskId: string
  entityType: string
  entityId: string
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
  message?: string,
  options?: { allowAutoRetry?: boolean }
): Promise<void> {
  const retriedNodeId = await database.transaction(async (transaction) => {
    const [attempt]: CompletingAttemptRow[] = await transaction
      .select({
        runId: taskAttempts.runId,
        taskId: taskAttempts.taskId,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
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

    const retryable =
      status === 'failed' &&
      message !== undefined &&
      (options?.allowAutoRetry ?? true) &&
      shouldAutoRetry(message, attempt.attemptNo, retryStage(attempt.checkpoint))
    if (retryable) {
      await scheduleRetry(transaction, workspaceId, attemptId, attempt, message!)
      return attempt.entityType === 'node' ? attempt.entityId : null
    }

    await transaction
      .update(taskAttempts)
      .set({
        status,
        failure: message ? { schemaVersion: 1, message } : null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taskAttempts.workspaceId, workspaceId),
          eq(taskAttempts.id, attemptId)
        )
      )
    await transaction
      .update(pipelineRuns)
      .set({ status, completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(pipelineRuns.workspaceId, workspaceId),
          eq(pipelineRuns.id, attempt.runId)
        )
      )
    return null
  })
  if (retriedNodeId) await resetNodeForRetry(workspaceId, retriedNodeId)
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/** 原 attempt 置 superseded，同 run 插入退避后的重试 attempt；run 回 queued。 */
async function scheduleRetry(
  transaction: Transaction,
  workspaceId: string,
  attemptId: string,
  attempt: CompletingAttemptRow,
  message: string
): Promise<void> {
  await transaction
    .update(taskAttempts)
    .set({
      status: 'superseded',
      failure: { schemaVersion: 1, message },
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(taskAttempts.id, attemptId)
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
    checkpoint: attempt.checkpoint,
    // 用 DB 时钟计算退避，避免应用与 DB 时钟漂移（与 leaseDeadline 同理）。
    visibleAt: sql`now() + make_interval(secs => ${backoffMs(attempt.attemptNo) / 1000})`,
  })
  await transaction
    .update(pipelineRuns)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(
      and(
        eq(pipelineRuns.workspaceId, workspaceId),
        eq(pipelineRuns.id, attempt.runId)
      )
    )
}

/**
 * 自动重试前把节点复位到 pending：两个 handler 开场都走 pending -> running，
 * 而首次失败的补偿已把节点置 failed（failed -> running 非法）。features 依赖
 * 按 lease.ts 的先例动态加载；复位失败只记日志，不阻断重试排队本身。
 */
async function resetNodeForRetry(
  workspaceId: string,
  nodeId: string
): Promise<void> {
  try {
    const { transitionNodeStatus } = await import('@/features/canvas/status')
    await runInAuthContext({ workspaceId, userId: SYSTEM_USER_ID }, () =>
      transitionNodeStatus(nodeId, 'pending')
    )
  } catch (error) {
    // 节点可能已被用户/其他路径改走（如仍在 running），容错不阻断。
    console.error('[queue] 自动重试的节点复位失败', { nodeId, error })
  }
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
