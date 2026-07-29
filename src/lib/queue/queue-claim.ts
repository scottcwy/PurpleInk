import { and, asc, eq, like, lte, notInArray, sql } from 'drizzle-orm'
import { tryAcquireWorkflowSlotInTransaction } from '@/features/ai/workspace-concurrency'
import { patchPayload } from '@/features/canvas/status-payload'
import { getDb } from '@/lib/db/client'
import { canvasNodes, pipelineRuns, taskAttempts } from '@/lib/db/schema'
import { parseCheckpoint } from './attempt-checkpoint'
import { leaseDeadline } from './lease'
import type { QueueJob } from './types'

export type ClaimFilter = { kind: string } | { excludeKinds: string[] }

/** 原子领取一条可见作业，并在同一事务中执行账号分镜槽门禁。 */
export async function claimNextJob(
  filter: ClaimFilter,
): Promise<QueueJob | null> {
  const database = await getDb()
  return database.transaction(async (transaction) => {
    const kindCondition = 'kind' in filter
      ? eq(taskAttempts.taskId, `legacy.${filter.kind}`)
      : and(
          like(taskAttempts.taskId, 'legacy.%'),
          notInArray(
            taskAttempts.taskId,
            filter.excludeKinds.map((kind) => `legacy.${kind}`),
          ),
        )
    const [row] = await transaction
      .select({
        id: taskAttempts.id,
        workspaceId: taskAttempts.workspaceId,
        runId: taskAttempts.runId,
        taskId: taskAttempts.taskId,
        checkpoint: taskAttempts.checkpoint,
        attemptNo: taskAttempts.attemptNo,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
        projectId: pipelineRuns.projectId,
        requestedByUserId: pipelineRuns.requestedByUserId,
      })
      .from(taskAttempts)
      .innerJoin(
        pipelineRuns,
        and(
          eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
          eq(pipelineRuns.id, taskAttempts.runId),
        ),
      )
      .where(and(
        eq(taskAttempts.status, 'queued'),
        lte(taskAttempts.visibleAt, sql`now()`),
        kindCondition,
      ))
      .orderBy(asc(taskAttempts.createdAt), asc(taskAttempts.id))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!row) return null
    if (!await acquireShotSlot(transaction, row)) return null
    const [claimed] = await transaction
      .update(taskAttempts)
      .set({
        status: 'running',
        leaseExpiresAt: leaseDeadline(row.taskId.slice('legacy.'.length)),
        startedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(
        eq(taskAttempts.workspaceId, row.workspaceId),
        eq(taskAttempts.id, row.id),
        eq(taskAttempts.status, 'queued'),
      ))
      .returning({ id: taskAttempts.id })
    if (!claimed) return null
    await transaction
      .update(pipelineRuns)
      .set({ status: 'running', startedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(
        eq(pipelineRuns.workspaceId, row.workspaceId),
        eq(pipelineRuns.id, row.runId),
      ))
    const checkpoint = parseCheckpoint(row.checkpoint)
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      requestedByUserId: row.requestedByUserId,
      kind: checkpoint.kind,
      status: 'running',
      payload: checkpoint.payload,
      attempts: row.attemptNo,
    }
  })
}

type Transaction = Parameters<
  Parameters<Awaited<ReturnType<typeof getDb>>['transaction']>[0]
>[0]

interface ClaimRow {
  id: string
  workspaceId: string
  entityType: string
  entityId: string
  requestedByUserId: string | null
  projectId: string
}

async function acquireShotSlot(
  transaction: Transaction,
  row: ClaimRow,
): Promise<boolean> {
  if (row.entityType !== 'node') return true
  const [node] = await transaction
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(
      eq(canvasNodes.workspaceId, row.workspaceId),
      eq(canvasNodes.id, row.entityId),
    ))
    .limit(1)
  const workUnitKey = readLaneKey(node?.data)
  if (!workUnitKey) return true
  const decision = await tryAcquireWorkflowSlotInTransaction(transaction, {
    workspaceId: row.workspaceId,
    actorUserId: row.requestedByUserId,
    projectId: row.projectId,
    workUnitKey,
  })
  if (decision.status === 'active') return true
  const resumeAt = decision.resumeAt ?? new Date(Date.now() + 1_000)
  await transaction
    .update(taskAttempts)
    .set({ visibleAt: resumeAt, updatedAt: sql`now()` })
    .where(and(
      eq(taskAttempts.workspaceId, row.workspaceId),
      eq(taskAttempts.id, row.id),
      eq(taskAttempts.status, 'queued'),
    ))
  if (node) {
    await transaction
      .update(canvasNodes)
      .set({
        data: patchPayload(node.data, {
          executionNotice: {
            code: 'PLAN_CONCURRENCY_WAIT',
            message:
              `套餐并发 ${decision.active}/${decision.limit} · ${decision.waiting} 个分镜排队`,
            resumeAt: resumeAt.toISOString(),
            active: decision.active,
            limit: decision.limit,
            waiting: decision.waiting,
          },
        }),
        updatedAt: sql`now()`,
      })
      .where(and(
        eq(canvasNodes.workspaceId, row.workspaceId),
        eq(canvasNodes.id, row.entityId),
      ))
  }
  return false
}

function readLaneKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const payload = (value as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const laneKey = (payload as Record<string, unknown>).laneKey
  return typeof laneKey === 'string' && laneKey.length > 0 ? laneKey : null
}
