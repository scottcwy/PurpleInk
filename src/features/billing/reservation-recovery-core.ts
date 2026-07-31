import { and, eq, inArray, isNull, ne, not, or } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  aiInvocations,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema'
import { settleManagedInvocationInDatabase } from './managed-settlement-core'

/** CAS 对账失去当前活动父 attempt 的 managed invocation。 */
export async function reconcileOrphanedManagedInvocationsInDatabase(
  database: Db,
): Promise<string[]> {
  const rows = await database
    .select({
      workspaceId: aiInvocations.workspaceId,
      invocationId: aiInvocations.id,
      providerStartedAt: aiInvocations.providerStartedAt,
    })
    .from(aiInvocations)
    .leftJoin(taskAttempts, and(
      eq(taskAttempts.workspaceId, aiInvocations.workspaceId),
      eq(taskAttempts.id, aiInvocations.attemptId),
    ))
    .leftJoin(pipelineRuns, and(
      eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
      eq(pipelineRuns.id, taskAttempts.runId),
    ))
    .leftJoin(projects, and(
      eq(projects.workspaceId, pipelineRuns.workspaceId),
      eq(projects.id, pipelineRuns.projectId),
    ))
    .where(and(
      eq(aiInvocations.status, 'running'),
      eq(aiInvocations.billingStatus, 'reserved'),
      or(
        isNull(taskAttempts.id),
        not(inArray(taskAttempts.status, ['queued', 'running'])),
        isNull(pipelineRuns.id),
        isNull(projects.id),
        ne(pipelineRuns.executionEpoch, projects.executionEpoch),
      ),
    ))
  for (const row of rows) {
    await settleManagedInvocationInDatabase(database, {
      workspaceId: row.workspaceId,
      invocationId: row.invocationId,
      actualCostCnyMicros: BigInt(0),
      usageStatus: row.providerStartedAt === null ? 'reported' : 'unavailable',
      measurementQuality: row.providerStartedAt === null ? 'reported' : 'estimated',
      invocationStatus: row.providerStartedAt === null ? 'cancelled' : 'failed',
      billingStatus: row.providerStartedAt === null ? 'released' : 'settled',
      failureKind: row.providerStartedAt === null
        ? undefined
        : 'orphaned_after_provider_start',
      settleReservedMaximum: row.providerStartedAt !== null,
    })
  }
  return rows.map(({ invocationId }) => invocationId)
}
