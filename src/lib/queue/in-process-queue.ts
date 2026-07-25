import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import { and, asc, eq, like, notInArray } from 'drizzle-orm'
import { getDb, LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema/index'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import type { JobHandler, LaneQuotas, QueueAdapter, QueueJob } from './types'

interface LegacyQueueCheckpoint {
  schemaVersion: number
  kind: string
  payload: Record<string, unknown>
}

/** 未在 `start(lanes)` 中显式配额的 kind 落入此通道，固定配额 1。 */
const FALLBACK_LANE = '__fallback__'
const FALLBACK_LANE_QUOTA = 1

export const DEFAULT_DIRECTOR_STAGE_CONCURRENCY = 12

export function defaultRenderShotConcurrency(): number {
  return Math.max(1, Math.floor(os.cpus().length / 2))
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
  private readonly running = new Map<string, number>()
  private lanes: Record<string, number> = {}

  async enqueue(
    kind: string,
    payload: Record<string, unknown> = {},
    opts: { projectId?: string; nodeId?: string } = {},
  ): Promise<string> {
    if (!opts.projectId) {
      throw new Error('legacy queue enqueue requires a trusted projectId')
    }
    const database = await getDb()
    const runId = randomUUID()
    const attemptId = randomUUID()
    const fingerprint = queueFingerprint(kind, payload)
    await database.transaction(async (transaction) => {
      await transaction.insert(pipelineRuns).values({
        workspaceId: LOCAL_WORKSPACE_ID,
        id: runId,
        projectId: opts.projectId!,
        status: 'queued',
        workflowVersion: serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION),
        fingerprint,
      })
      await transaction.insert(taskAttempts).values({
        workspaceId: LOCAL_WORKSPACE_ID,
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
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
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
      this.running.set(laneKey, (this.running.get(laneKey) ?? 0) + 1)
      void this.run(job).finally(() => {
        this.running.set(laneKey, (this.running.get(laneKey) ?? 0) - 1)
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
          runId: taskAttempts.runId,
          taskId: taskAttempts.taskId,
          checkpoint: taskAttempts.checkpoint,
          attemptNo: taskAttempts.attemptNo,
        })
        .from(taskAttempts)
        .where(
          and(
            eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
            eq(taskAttempts.status, 'queued'),
            kindCondition
          )
        )
        .orderBy(asc(taskAttempts.createdAt), asc(taskAttempts.id))
        .limit(1)
        .for('update', { skipLocked: true })
      if (!row) return null
      const [claimed] = await transaction
        .update(taskAttempts)
        .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
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
            eq(pipelineRuns.workspaceId, LOCAL_WORKSPACE_ID),
            eq(pipelineRuns.id, row.runId)
          )
        )
      const checkpoint = parseCheckpoint(row.checkpoint)
      return {
        id: row.id,
        kind: checkpoint.kind,
        status: 'running',
        payload: checkpoint.payload,
        attempts: row.attemptNo,
      }
    })
  }

  private async run(job: QueueJob): Promise<void> {
    const database = await getDb()
    const handler = this.handlers.get(job.kind)
    if (!handler) {
      await completeAttempt(database, job.id, 'failed', `no handler for kind: ${job.kind}`)
      return
    }
    try {
      await handler(job)
      await completeAttempt(database, job.id, 'succeeded')
    } catch (err) {
      await completeAttempt(
        database,
        job.id,
        'failed',
        err instanceof Error ? err.message : String(err)
      )
    }
  }
}

function queueFingerprint(
  kind: string,
  payload: Record<string, unknown>
): string {
  return createHash('sha256')
    .update(kind)
    .update('\0')
    .update(JSON.stringify(payload))
    .digest('hex')
}

function parseCheckpoint(value: unknown): LegacyQueueCheckpoint {
  if (!value || typeof value !== 'object') {
    throw new Error('legacy queue checkpoint is invalid')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.kind !== 'string' ||
    !record.payload ||
    typeof record.payload !== 'object' ||
    Array.isArray(record.payload)
  ) {
    throw new Error('legacy queue checkpoint is invalid')
  }
  return {
    schemaVersion: 1,
    kind: record.kind,
    payload: record.payload as Record<string, unknown>,
  }
}

async function completeAttempt(
  database: Db,
  attemptId: string,
  status: 'succeeded' | 'failed',
  message?: string
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [attempt] = await transaction
      .update(taskAttempts)
      .set({
        status,
        failure: message ? { schemaVersion: 1, message } : null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(taskAttempts.id, attemptId)
        )
      )
      .returning({ runId: taskAttempts.runId })
    if (!attempt) throw new Error(`legacy queue attempt not found: ${attemptId}`)
    await transaction
      .update(pipelineRuns)
      .set({
        status,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pipelineRuns.workspaceId, LOCAL_WORKSPACE_ID),
          eq(pipelineRuns.id, attempt.runId)
        )
      )
  })
}
