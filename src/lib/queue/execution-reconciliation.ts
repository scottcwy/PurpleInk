import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  providerDispatches,
  taskAttempts,
  workflowConcurrencyLeases,
} from '@/lib/db/schema'

/** 取消已被项目 execution_epoch 栅栏淘汰、但仍残留在 queued 的历史作业。 */
export async function reconcileStaleExecutionEpochs(db: Db): Promise<string[]> {
  const rows = await db.transaction(async (transaction) => {
    const stale = await transaction
      .select({
        id: taskAttempts.id,
        workspaceId: taskAttempts.workspaceId,
        runId: taskAttempts.runId,
        projectId: pipelineRuns.projectId,
        entityType: taskAttempts.entityType,
        entityId: taskAttempts.entityId,
        workUnitKey: taskAttempts.workUnitKey,
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
      .where(and(
        eq(taskAttempts.status, 'queued'),
        ne(pipelineRuns.executionEpoch, projects.executionEpoch),
      ))
      .for('update', { of: taskAttempts, skipLocked: true })
    if (stale.length === 0) return stale

    const ids = stale.map(({ id }) => id)
    const runIds = [...new Set(stale.map(({ runId }) => runId))]
    await transaction
      .update(taskAttempts)
      .set({
        status: 'cancelled',
        failure: {
          schemaVersion: 2,
          code: 'TASK_INTERRUPTED',
          message: '项目已进入新的执行代次，旧排队任务已取消',
          retryable: true,
        },
        cancelRequestedAt: sql`now()`,
        leaseExpiresAt: null,
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(inArray(taskAttempts.id, ids))
    await transaction
      .update(pipelineRuns)
      .set({ status: 'cancelled', completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(
        inArray(pipelineRuns.id, runIds),
        inArray(pipelineRuns.status, ['triggering', 'queued']),
      ))
    await transaction
      .update(providerDispatches)
      .set({ status: 'cancelled', releasedAt: sql`now()` })
      .where(and(
        inArray(providerDispatches.attemptId, ids),
        eq(providerDispatches.status, 'scheduled'),
      ))

    for (const row of stale) {
      if (row.entityType === 'node') {
        await transaction
          .update(canvasNodes)
          .set({ status: 'cancelled', updatedAt: sql`now()` })
          .where(and(
            eq(canvasNodes.workspaceId, row.workspaceId),
            eq(canvasNodes.projectId, row.projectId),
            eq(canvasNodes.id, row.entityId),
            eq(canvasNodes.status, 'queued'),
          ))
      }
      if (row.workUnitKey) {
        await transaction
          .update(workflowConcurrencyLeases)
          .set({
            status: 'cancelled',
            leaseExpiresAt: null,
            releasedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(and(
            eq(workflowConcurrencyLeases.workspaceId, row.workspaceId),
            eq(workflowConcurrencyLeases.projectId, row.projectId),
            eq(workflowConcurrencyLeases.workUnitKey, row.workUnitKey),
            eq(workflowConcurrencyLeases.status, 'waiting'),
          ))
      }
    }
    return stale
  })
  for (const row of rows) {
    console.info('[stale_execution_fenced]', {
      attemptId: row.id,
      projectId: row.projectId,
    })
  }
  return rows.map(({ id }) => id)
}

export async function reconcileOrphanedWorkflowLeases(db: Db): Promise<number> {
  const rows = await db.update(workflowConcurrencyLeases).set({
    status: 'cancelled',
    leaseExpiresAt: null,
    releasedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    inArray(workflowConcurrencyLeases.status, ['waiting', 'active']),
    sql`not exists (
      select 1
      from task_attempts parent_attempt
      join pipeline_runs parent_run
        on parent_run.workspace_id = parent_attempt.workspace_id
       and parent_run.id = parent_attempt.run_id
      join projects parent_project
        on parent_project.workspace_id = parent_run.workspace_id
       and parent_project.id = parent_run.project_id
      where parent_attempt.workspace_id = ${workflowConcurrencyLeases.workspaceId}
        and parent_run.project_id = ${workflowConcurrencyLeases.projectId}
        and parent_attempt.work_unit_key = ${workflowConcurrencyLeases.workUnitKey}
        and parent_attempt.status in ('queued', 'running')
        and parent_run.execution_epoch = parent_project.execution_epoch
    )`,
  )).returning({ workUnitKey: workflowConcurrencyLeases.workUnitKey })
  if (rows.length > 0) {
    console.info('[workflow_lease_reconciled]', { count: rows.length })
  }
  return rows.length
}

export async function reconcileExecutionResources(db: Db) {
  const staleAttemptIds = await reconcileStaleExecutionEpochs(db)
  const orphanedLeases = await reconcileOrphanedWorkflowLeases(db)
  const { reconcileOrphanedAiInvocations } = await import(
    '@/features/ai/invocation-recovery'
  )
  const orphanedInvocationIds = await reconcileOrphanedAiInvocations(db)
  return { staleAttemptIds, orphanedLeases, orphanedInvocationIds }
}
