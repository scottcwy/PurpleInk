import { and, eq, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm'
import { PIPELINE_STAGES, type PipelineStage } from '@/features/director/types'
import { runInAuthContext, SYSTEM_USER_ID } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import { canvasNodes, pipelineRuns, taskAttempts } from '@/lib/db/schema/index'

/** running attempt 的租约时长；持有进程按 HEARTBEAT_INTERVAL_MS 心跳续期。 */
export const LEASE_DURATION_MS = 120_000
export const HEARTBEAT_INTERVAL_MS = 30_000
export const SWEEP_INTERVAL_MS = 60_000

const MINUTE_MS = 60_000

/** 按 kind 的执行超时；未登记的 kind 用 DEFAULT_EXECUTION_TIMEOUT_MS 兜底。 */
export const EXECUTION_TIMEOUT_MS: Readonly<Record<string, number>> = {
  'director-stage': 10 * MINUTE_MS,
  'render-shot': 15 * MINUTE_MS,
}
export const DEFAULT_EXECUTION_TIMEOUT_MS = 10 * MINUTE_MS

/** 写入 task_attempts.failure 的原始报文；workflow-error 靠它归类 TASK_INTERRUPTED。 */
export const LEASE_EXPIRED_FAILURE_MESSAGE = '执行进程中断，租约过期自动回收'

export function executionTimeoutMs(kind: string): number {
  return EXECUTION_TIMEOUT_MS[kind] ?? DEFAULT_EXECUTION_TIMEOUT_MS
}

/** 用 DB 时钟计算租约到期时间，避免应用与 DB 时钟漂移导致误回收。 */
export function leaseDeadline(): SQL {
  return sql`now() + make_interval(secs => ${LEASE_DURATION_MS / 1000})`
}

export class ExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`阶段执行超时（${Math.round(timeoutMs / MINUTE_MS)} 分钟），已强制释放`)
    this.name = 'ExecutionTimeoutError'
  }
}

/** 按 kind 的超时包住 handler；超时后 handler promise 仍在后台，迟到的 rejection 被吞掉。 */
export async function withExecutionTimeout<T>(
  kind: string,
  task: () => Promise<T>
): Promise<T> {
  const timeoutMs = executionTimeoutMs(kind)
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExecutionTimeoutError(timeoutMs)), timeoutMs)
  })
  const running = task()
  // 预挂 catch：超时胜出后 handler 迟到的失败不得变成 unhandled rejection。
  running.catch(() => undefined)
  try {
    return await Promise.race([running, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** 只续租传入的（本进程持有的）running attempt；空列表是空闲心跳的 no-op。 */
export async function renewLeases(db: Db, attemptIds: string[]): Promise<void> {
  if (attemptIds.length === 0) return
  await db
    .update(taskAttempts)
    .set({ leaseExpiresAt: leaseDeadline(), updatedAt: new Date() })
    .where(
      and(
        eq(taskAttempts.status, 'running'),
        inArray(taskAttempts.id, attemptIds)
      )
    )
}

interface ExpiredAttemptRow {
  id: string
  workspaceId: string
  runId: string
  entityType: string
  entityId: string
  checkpoint: unknown
  nodeStage: string | null
}

/**
 * 回收租约过期的僵尸 attempt：持有进程崩溃/重启后不再心跳，租约过期即视为
 * 执行中断。attempt 与 run 在同一事务内置 failed；节点投影在事务外逐条容错，
 * 单个节点失败（如已不在 running）不阻断其余回收。
 */
export async function sweepExpiredLeases(db: Db): Promise<string[]> {
  const expired = await db.transaction(async (transaction) => {
    const rows: ExpiredAttemptRow[] = await transaction
      .select({
        id: taskAttempts.id,
        workspaceId: taskAttempts.workspaceId,
        runId: taskAttempts.runId,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
        checkpoint: taskAttempts.checkpoint,
        nodeStage: canvasNodes.stage,
      })
      .from(taskAttempts)
      .leftJoin(
        canvasNodes,
        and(
          eq(canvasNodes.workspaceId, taskAttempts.workspaceId),
          eq(canvasNodes.id, taskAttempts.entityId)
        )
      )
      .where(
        and(
          eq(taskAttempts.status, 'running'),
          isNotNull(taskAttempts.leaseExpiresAt),
          lt(taskAttempts.leaseExpiresAt, sql`now()`)
        )
      )
      .for('update', { of: taskAttempts, skipLocked: true })
    for (const row of rows) {
      await transaction
        .update(taskAttempts)
        .set({
          status: 'failed',
          failure: { schemaVersion: 1, message: LEASE_EXPIRED_FAILURE_MESSAGE },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(taskAttempts.workspaceId, row.workspaceId),
            eq(taskAttempts.id, row.id)
          )
        )
      await transaction
        .update(pipelineRuns)
        .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pipelineRuns.workspaceId, row.workspaceId),
            eq(pipelineRuns.id, row.runId)
          )
        )
    }
    return rows
  })
  await projectInterruptedNodes(
    db,
    expired.filter((row) => row.entityType === 'node')
  )
  return expired.map((row) => row.id)
}

/**
 * 把中断投影写到节点：running -> failed，directorError 走既有
 * recordStageError（classifyWorkflowError 会把租约过期报文归类为
 * TASK_INTERRUPTED），不另造平行写入路径。features 依赖按 init.ts 的
 * 先例动态加载，避免 lib/queue 与 features 的静态循环依赖。
 */
async function projectInterruptedNodes(
  db: Db,
  rows: ExpiredAttemptRow[]
): Promise<void> {
  if (rows.length === 0) return
  const [{ transitionNodeStatus }, { DirectorRuntimeRepository }, { storage }] =
    await Promise.all([
      import('@/features/canvas/status'),
      import('@/features/director/runtime-repository'),
      import('@/lib/storage'),
    ])
  const repository = new DirectorRuntimeRepository(db, storage)
  for (const row of rows) {
    try {
      // status.ts 与 runtime-repository 从 auth 上下文取 workspaceId；sweep 是
      // 无请求上下文的后台任务，按 attempt 行自身的归属建立上下文（与
      // attempt-completion 的 resetNodeForRetry 同一先例）。
      await runInAuthContext(
        { workspaceId: row.workspaceId, userId: SYSTEM_USER_ID },
        async () => {
          await transitionNodeStatus(row.entityId, 'failed')
          await repository.recordStageError(
            row.entityId,
            resolveStage(row),
            new Error(LEASE_EXPIRED_FAILURE_MESSAGE)
          )
        }
      )
    } catch (error) {
      // 节点可能已被用户/其他路径改走（不在 running），逐条容错，不让 sweep 崩溃。
      console.error('[queue] 僵尸回收的节点投影失败', {
        attemptId: row.id,
        nodeId: row.entityId,
        error,
      })
    }
  }
}

/** 阶段仅用于投影展示：优先 checkpoint 里的作业阶段，其次节点自身阶段。 */
function resolveStage(row: ExpiredAttemptRow): PipelineStage {
  const checkpointStage = readCheckpointStage(row.checkpoint)
  if (checkpointStage) return checkpointStage
  if (isPipelineStage(row.nodeStage)) return row.nodeStage
  return 'FINALIZE'
}

function readCheckpointStage(checkpoint: unknown): PipelineStage | null {
  if (!checkpoint || typeof checkpoint !== 'object') return null
  const payload = (checkpoint as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return null
  const stage = (payload as Record<string, unknown>).stage
  return isPipelineStage(stage) ? stage : null
}

function isPipelineStage(value: unknown): value is PipelineStage {
  return (
    typeof value === 'string' &&
    (PIPELINE_STAGES as readonly string[]).includes(value)
  )
}
