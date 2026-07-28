import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { and, asc, eq, like, lte, notInArray, sql } from 'drizzle-orm'
import {
  currentWorkspaceId,
  runInAuthContext,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema/index'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import { completeAttempt } from './attempt-completion'
import { parseCheckpoint, queueFingerprint } from './attempt-checkpoint'
import {
  HEARTBEAT_INTERVAL_MS,
  SWEEP_INTERVAL_MS,
  leaseDeadline,
  renewLeases,
  sweepExpiredLeases,
  withExecutionTimeout,
} from './lease'
import type { JobHandler, LaneQuotas, QueueAdapter, QueueJob } from './types'

/** 未在 `start(lanes)` 中显式配额的 kind 落入此通道，固定配额 1。 */
const FALLBACK_LANE = '__fallback__'
const FALLBACK_LANE_QUOTA = 1

export const DEFAULT_DIRECTOR_STAGE_CONCURRENCY = 12

export function defaultRenderShotConcurrency(): number {
  // 容器 cgroup 限额下 cpus() 会高估；availableParallelism 更贴近真实可用并行度。
  return Math.min(8, Math.max(1, os.availableParallelism()))
}

function defaultLaneQuotas(): Record<string, number> {
  return {
    'director-stage': DEFAULT_DIRECTOR_STAGE_CONCURRENCY,
    'render-shot': defaultRenderShotConcurrency(),
  }
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1
}

function resolveLanes(lanes: LaneQuotas): Record<string, number> {
  const resolved = defaultLaneQuotas()
  for (const [kind, quota] of Object.entries(lanes)) {
    if (quota === undefined) continue
    resolved[kind] = quota
  }
  for (const [kind, quota] of Object.entries(resolved)) {
    if (!isPositiveInteger(quota)) {
      throw new Error(
        `legacy queue lane quota for kind "${kind}" must be a positive integer, got: ${quota}`
      )
    }
  }
  return resolved
}

type ClaimFilter = { kind: string } | { excludeKinds: string[] }

export class InProcessQueue implements QueueAdapter {
  private readonly handlers = new Map<string, JobHandler>()
  private timer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly running = new Map<string, number>()
  /** 本进程当前持有的 running attempt；心跳只续租这些。 */
  private readonly heldAttempts = new Set<string>()
  private lanes: Record<string, number> = {}

  async enqueue(
    kind: string,
    payload: Record<string, unknown> = {},
    opts: { projectId?: string; nodeId?: string } = {},
  ): Promise<string> {
    if (!opts.projectId) {
      throw new Error('legacy queue enqueue requires a trusted projectId')
    }
    // 入队发生在请求上下文内，归属取自当前会话；无上下文即抛错，
    // 不回落到常量（PLAN-002 §5.3 / §10 禁区 5）。
    const workspaceId = currentWorkspaceId()
    const database = await getDb()
    const runId = randomUUID()
    const attemptId = randomUUID()
    const fingerprint = queueFingerprint(kind, payload)
    await database.transaction(async (transaction) => {
      await transaction.insert(pipelineRuns).values({
        workspaceId,
        id: runId,
        projectId: opts.projectId!,
        status: 'queued',
        workflowVersion: serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION),
        fingerprint,
      })
      await transaction.insert(taskAttempts).values({
        workspaceId,
        id: attemptId,
        runId,
        taskId: `legacy.${kind}`,
        entityType: opts.nodeId ? 'node' : 'project',
        entityId: opts.nodeId ?? opts.projectId!,
        attemptNo: 1,
        status: 'queued',
        fingerprint,
        checkpoint: { schemaVersion: 1, kind, payload },
      })
    })
    return attemptId
  }

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler)
  }

  start(lanes: LaneQuotas = {}): void {
    const resolved = resolveLanes(lanes)
    if (this.timer) return
    this.lanes = resolved
    this.timer = setInterval(() => void this.tick(), 200)
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      HEARTBEAT_INTERVAL_MS
    )
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS)
    // 启动即回收上个进程崩溃遗留的僵尸 attempt，不等首个 sweep 周期。
    void this.sweep()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.heldAttempts.size === 0) return
    try {
      await renewLeases(await getDb(), [...this.heldAttempts])
    } catch (error) {
      // 续租失败不能打断消费循环；持续失败的后果是租约过期被 sweep 回收。
      console.error('[queue] 租约续期失败', error)
    }
  }

  private async sweep(): Promise<void> {
    try {
      await sweepExpiredLeases(await getDb())
    } catch (error) {
      console.error('[queue] 僵尸 attempt 回收失败', error)
    }
  }

  private async tick(): Promise<void> {
    const knownKinds = Object.keys(this.lanes)
    await Promise.all([
      ...knownKinds.map((kind) =>
        this.drainLane(kind, this.lanes[kind]!, { kind })
      ),
      this.drainLane(FALLBACK_LANE, FALLBACK_LANE_QUOTA, {
        excludeKinds: knownKinds,
      }),
    ])
  }

  /** 在单个通道内按配额领取作业；`laneKey` 是并发计数的桶，不一定等于作业的真实 kind（兜底通道混装多个未登记 kind）。 */
  private async drainLane(
    laneKey: string,
    quota: number,
    filter: ClaimFilter
  ): Promise<void> {
    while ((this.running.get(laneKey) ?? 0) < quota) {
      const job = await this.claim(filter)
      if (!job) return
      this.heldAttempts.add(job.id)
      this.running.set(laneKey, (this.running.get(laneKey) ?? 0) + 1)
      // run() 已把超时也收敛为正常返回，finally 只会执行一次：
      // 后台残留的 handler promise 不会重复递减计数或重复释放持有集合。
      void this.run(job).finally(() => {
        this.running.set(laneKey, (this.running.get(laneKey) ?? 0) - 1)
        this.heldAttempts.delete(job.id)
      })
    }
  }

  private async claim(filter: ClaimFilter): Promise<QueueJob | null> {
    const database = await getDb()
    return database.transaction(async (transaction) => {
      const kindCondition =
        'kind' in filter
          ? eq(taskAttempts.taskId, `legacy.${filter.kind}`)
          : and(
              like(taskAttempts.taskId, 'legacy.%'),
              notInArray(
                taskAttempts.taskId,
                filter.excludeKinds.map((kind) => `legacy.${kind}`)
              )
            )
      const [row] = await transaction
        .select({
          id: taskAttempts.id,
          workspaceId: taskAttempts.workspaceId,
          runId: taskAttempts.runId,
          taskId: taskAttempts.taskId,
          checkpoint: taskAttempts.checkpoint,
          attemptNo: taskAttempts.attemptNo,
        })
        .from(taskAttempts)
        .where(
          // 不按 workspace 过滤：消费者要处理全部 workspace 的作业，
          // 归属由领到的 attempt 行自身的 workspaceId 决定（PLAN-002 §5.3）。
          // visible_at 非空且默认 now()，直接比较即可（退避重排属阶段 2）。
          and(
            eq(taskAttempts.status, 'queued'),
            lte(taskAttempts.visibleAt, sql`now()`),
            kindCondition
          )
        )
        .orderBy(asc(taskAttempts.createdAt), asc(taskAttempts.id))
        .limit(1)
        .for('update', { skipLocked: true })
      if (!row) return null
      const [claimed] = await transaction
        .update(taskAttempts)
        .set({
          status: 'running',
          leaseExpiresAt: leaseDeadline(),
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(taskAttempts.workspaceId, row.workspaceId),
            eq(taskAttempts.id, row.id),
            eq(taskAttempts.status, 'queued')
          )
        )
        .returning({ id: taskAttempts.id })
      if (!claimed) return null
      await transaction
        .update(pipelineRuns)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pipelineRuns.workspaceId, row.workspaceId),
            eq(pipelineRuns.id, row.runId)
          )
        )
      const checkpoint = parseCheckpoint(row.checkpoint)
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        kind: checkpoint.kind,
        status: 'running',
        payload: checkpoint.payload,
        attempts: row.attemptNo,
      }
    })
  }

  /**
   * 执行已领取的作业。handler 在 attempt 行自身的 workspace 上下文内运行：
   * 队列是没有请求上下文的后台消费者，userId 用 SYSTEM_USER_ID 占位，
   * 真实归属由 attempt 行决定（PLAN-002 §5.3）。
   */
  private async run(job: QueueJob): Promise<void> {
    const database = await getDb()
    const handler = this.handlers.get(job.kind)
    if (!handler) {
      // 未注册 handler 是进程内配置缺口，重试无法自愈，直接终态。
      await completeAttempt(
        database,
        job.workspaceId,
        job.id,
        'failed',
        `no handler for kind: ${job.kind}`,
        { allowAutoRetry: false }
      )
      return
    }
    try {
      await withExecutionTimeout(job.kind, () =>
        runInAuthContext(
          { workspaceId: job.workspaceId, userId: SYSTEM_USER_ID },
          () => handler(job)
        )
      )
      await completeAttempt(database, job.workspaceId, job.id, 'succeeded')
    } catch (err) {
      await completeAttempt(
        database,
        job.workspaceId,
        job.id,
        'failed',
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}
