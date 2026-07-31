import {
  runInAuthContext,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'
import { ProviderQueueDeferral } from '@/features/ai/provider-queue-deferral'
import { releaseTerminalWorkflowSlotForNode } from '@/features/ai/workspace-concurrency-release'
import { completeAttempt } from './attempt-completion'
import { safeErrorDetails } from './queue-error-details'
import {
  HEARTBEAT_INTERVAL_MS,
  SWEEP_INTERVAL_MS,
  renewLeases,
  sweepExpiredLeases,
  withExecutionTimeout,
} from './lease'
import type { JobHandler, LaneQuotas, QueueAdapter, QueueJob } from './types'
import type { ClaimFilter } from './queue-claim'
import { defaultQueueLaneQuotas } from './queue-defaults'
import {
  registerAttemptController,
  unregisterAttemptController,
} from './execution-cancellation'
import {
  enqueueLegacyJob,
  type QueueEnqueueOptions,
} from './queue-enqueue'

/** 未在 `start(lanes)` 中显式配额的 kind 落入此通道，固定配额 1。 */
const FALLBACK_LANE = '__fallback__'
const FALLBACK_LANE_QUOTA = 1

function defaultLaneQuotas(): Record<string, number> {
  return defaultQueueLaneQuotas()
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

export class InProcessQueue implements QueueAdapter {
  private readonly handlers = new Map<string, JobHandler>()
  private timer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly running = new Map<string, number>()
  /** 本进程当前持有的 running attempt；心跳只续租这些。 */
  private readonly heldAttempts = new Set<string>()
  private readonly activeExecutions = new Set<Promise<void>>()
  private readonly backgroundOperations = new Set<Promise<void>>()
  private tickInProgress = false
  private sweepInProgress = false
  private lanes: Record<string, number> = {}

  async enqueue(
    kind: string,
    payload: Record<string, unknown> = {},
    opts: QueueEnqueueOptions = {},
  ): Promise<string> {
    return enqueueLegacyJob(kind, payload, opts)
  }

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler)
  }

  start(lanes: LaneQuotas = {}): void {
    const resolved = resolveLanes(lanes)
    if (this.timer) return
    this.lanes = resolved
    this.timer = setInterval(
      () => this.trackBackground(this.runTick(), '消费循环失败'),
      200,
    )
    this.heartbeatTimer = setInterval(
      () => this.trackBackground(this.heartbeat(), '租约续期失败'),
      HEARTBEAT_INTERVAL_MS
    )
    this.sweepTimer = setInterval(
      () => this.trackBackground(this.runSweep(), '僵尸回收失败'),
      SWEEP_INTERVAL_MS,
    )
    // 启动即回收上个进程崩溃遗留的僵尸 attempt，不等首个 sweep 周期。
    this.trackBackground(this.runSweep(), '启动清扫失败')
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
      const database = await getDb()
      await sweepExpiredLeases(database)
      const { reconcileStaleExecutionEpochs } = await import(
        './execution-reconciliation'
      )
      await reconcileStaleExecutionEpochs(database)
      const { reconcileDirectorFrontiers } = await import(
        '@/features/director/frontier-reconciliation'
      )
      await reconcileDirectorFrontiers(database)
      const { reconcileExpiredProviderTickets } = await import(
        '@/features/ai/provider-dispatch-ticket'
      )
      await reconcileExpiredProviderTickets(database)
    } catch (error) {
      console.error('[queue] 僵尸 attempt 回收失败', error)
    }
  }

  private async tick(): Promise<void> {
    const knownKinds = Object.keys(this.lanes)
    for (const kind of knownKinds) {
      await this.drainLane(kind, this.lanes[kind]!, { kind })
    }
    await this.drainLane(FALLBACK_LANE, FALLBACK_LANE_QUOTA, {
      excludeKinds: knownKinds,
    })
  }

  /** 在单个通道内按配额领取作业；`laneKey` 是并发计数的桶，不一定等于作业的真实 kind（兜底通道混装多个未登记 kind）。 */
  private async drainLane(
    laneKey: string,
    quota: number,
    filter: ClaimFilter
  ): Promise<void> {
    const { claimNextJob } = await import('./queue-claim')
    while ((this.running.get(laneKey) ?? 0) < quota) {
      const job = await claimNextJob(filter)
      if (!job) return
      this.heldAttempts.add(job.id)
      this.running.set(laneKey, (this.running.get(laneKey) ?? 0) + 1)
      const execution = this.run(job)
      this.activeExecutions.add(execution)
      const release = (): void => {
        this.running.set(laneKey, (this.running.get(laneKey) ?? 0) - 1)
        this.heldAttempts.delete(job.id)
        this.activeExecutions.delete(execution)
      }
      void execution.then(release, (error: unknown) => {
        release()
        console.error('[queue] 作业收敛失败', error)
      })
    }
  }

  /**
   * 执行已领取的作业。handler 在 attempt 行自身的 workspace 上下文内运行：
   * 队列没有请求上下文，但 run 已固化真实发起账号；历史 run 无法归属时才使用
   * SYSTEM_USER_ID。重试、fallback 与自动续接因此不会覆盖原始发起人。
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
      await releaseTerminalSlot(database, job)
      return
    }
    const startedAt = Date.now()
    const controller = registerAttemptController(job.id)
    const cancellableJob = { ...job, signal: controller.signal }
    try {
      controller.signal.throwIfAborted()
      await withExecutionTimeout(
        job.kind,
        () =>
          runInAuthContext(
            {
              workspaceId: job.workspaceId,
              userId: job.requestedByUserId ?? SYSTEM_USER_ID,
            },
            () => handler(cancellableJob)
          ),
        controller,
      )
      controller.signal.throwIfAborted()
      await completeAttempt(database, job.workspaceId, job.id, 'succeeded')
    } catch (err) {
      if (err instanceof ProviderQueueDeferral) {
        console.info('[provider_queue_deferred]', {
          provider: err.providerId,
          attemptId: job.id,
          kind: job.kind,
          waitReason: err.waitReason,
          retryAt: err.retryAt,
        })
        await completeAttempt(
          database,
          job.workspaceId,
          job.id,
          'failed',
          err,
        )
        return
      }
      const fault = classifyWorkflowError(err, { stage: 'QUEUE' })
      console.error('[workflow-attempt]', JSON.stringify({
        referenceId: fault.referenceId,
        code: fault.code,
        origin: fault.origin,
        provider: fault.provider?.id ?? null,
        status: fault.provider?.httpStatus ?? null,
        stage: fault.stage,
        attemptId: job.id,
        kind: job.kind,
        durationMs: Date.now() - startedAt,
        retryAt: fault.provider?.retryAt ?? null,
        errorName: err instanceof Error ? err.name : 'NonErrorThrown',
        errorMessage: err instanceof Error ? err.message?.slice(0, 300) : null,
        details: safeErrorDetails(err),
      }))
      await completeAttempt(
        database,
        job.workspaceId,
        job.id,
        'failed',
        err
      )
    } finally {
      unregisterAttemptController(job.id, controller)
      await releaseTerminalSlot(database, job)
    }
  }

  private async runTick(): Promise<void> {
    if (this.tickInProgress) return
    this.tickInProgress = true
    try {
      await this.tick()
    } finally {
      this.tickInProgress = false
    }
  }

  private async runSweep(): Promise<void> {
    if (this.sweepInProgress) return
    this.sweepInProgress = true
    try {
      await this.sweep()
    } finally {
      this.sweepInProgress = false
    }
  }

  async stopAndDrain(timeoutMs = 30_000): Promise<void> {
    this.stop()
    const deadline = Date.now() + timeoutMs
    while (this.activeExecutions.size > 0 || this.backgroundOperations.size > 0) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw new Error('queue drain timed out')
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.allSettled([
            ...this.activeExecutions,
            ...this.backgroundOperations,
          ]),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('queue drain timed out')),
              remainingMs,
            )
          }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }
  }

  private trackBackground(operation: Promise<void>, label: string): void {
    this.backgroundOperations.add(operation)
    void operation.then(
      () => this.backgroundOperations.delete(operation),
      (error: unknown) => {
        this.backgroundOperations.delete(operation)
        console.error(`[queue] ${label}`, error)
      },
    )
  }
}

async function releaseTerminalSlot(
  database: Awaited<ReturnType<typeof getDb>>,
  job: QueueJob,
): Promise<void> {
  const nodeId = typeof job.payload.nodeId === 'string' ? job.payload.nodeId : null
  if (!nodeId) return
  try {
    await releaseTerminalWorkflowSlotForNode({
      workspaceId: job.workspaceId,
      nodeId,
      database,
    })
  } catch (error) {
    console.error('[queue] 分镜并发租约释放失败', { nodeId, error })
  }
}
