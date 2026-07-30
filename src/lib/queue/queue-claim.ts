import { and, asc, eq, like, lte, notInArray, sql } from 'drizzle-orm'
import { tryAcquireWorkflowSlotInTransaction } from '@/features/ai/workspace-concurrency'
import { patchPayload } from '@/features/canvas/status-payload'
import { getDb } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workflowConcurrencyLeases,
} from '@/lib/db/schema'
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
        workUnitKey: taskAttempts.workUnitKey,
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
      .innerJoin(
        projects,
        and(
          eq(projects.workspaceId, pipelineRuns.workspaceId),
          eq(projects.id, pipelineRuns.projectId),
        ),
      )
      .leftJoin(
        workflowConcurrencyLeases,
        and(
          eq(workflowConcurrencyLeases.workspaceId, taskAttempts.workspaceId),
          eq(workflowConcurrencyLeases.projectId, pipelineRuns.projectId),
          eq(workflowConcurrencyLeases.workUnitKey, taskAttempts.workUnitKey),
        ),
      )
      .where(and(
        eq(taskAttempts.status, 'queued'),
        lte(taskAttempts.visibleAt, sql`now()`),
        eq(pipelineRuns.executionEpoch, projects.executionEpoch),
        kindCondition,
      ))
      .orderBy(
        sql`case
          when ${workflowConcurrencyLeases.status} = 'active' then 0
          when ${taskAttempts.workUnitKey} is null then 1
          when ${workflowConcurrencyLeases.status} = 'waiting'
            and ${workflowConcurrencyLeases.notBefore} <= now() then 2
          when ${workflowConcurrencyLeases.workspaceId} is null then 2
          else 3
        end`,
        asc(taskAttempts.createdAt),
        asc(taskAttempts.id),
      )
      .limit(1)
      .for('update', { of: taskAttempts, skipLocked: true })
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
  workUnitKey: string | null
}

async function acquireShotSlot(
  transaction: Transaction,
  row: ClaimRow,
): Promise<boolean> {
  if (row.entityType !== 'node') return true
  if (!row.workUnitKey) return true
  const decision = await tryAcquireWorkflowSlotInTransaction(transaction, {
    workspaceId: row.workspaceId,
    actorUserId: row.requestedByUserId,
    projectId: row.projectId,
    workUnitKey: row.workUnitKey,
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
  const [node] = await transaction
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(
      eq(canvasNodes.workspaceId, row.workspaceId),
      eq(canvasNodes.projectId, row.projectId),
      eq(canvasNodes.id, row.entityId),
    ))
    .limit(1)
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
