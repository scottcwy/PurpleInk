import { and, eq, inArray, isNotNull, isNull, ne, not, or, sql } from 'drizzle-orm'
import { settleManagedInvocationInDatabase } from '@/features/billing/managed-settlement-core'
import { reconcileOrphanedManagedInvocationsInDatabase } from '@/features/billing/reservation-recovery-core'
import type { Db } from '@/lib/db/client'
import {
  aiInvocations,
  pipelineRuns,
  projects,
  taskAttempts,
} from '@/lib/db/schema'

interface RecoverableInvocation {
  workspaceId: string
  invocationId: string
  billingStatus: string
  providerStartedAt: Date | null
  capability: string | null
}

export async function reconcileOrphanedAiInvocationsInDatabase(
  database: Db,
): Promise<string[]> {
  const managedIds = await reconcileOrphanedManagedInvocationsInDatabase(database)
  const rows = await database
    .select({
      workspaceId: aiInvocations.workspaceId,
      invocationId: aiInvocations.id,
      billingStatus: aiInvocations.billingStatus,
      providerStartedAt: aiInvocations.providerStartedAt,
      capability: aiInvocations.capability,
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
      isNotNull(aiInvocations.attemptId),
      ne(aiInvocations.billingStatus, 'reserved'),
      or(
        isNull(taskAttempts.id),
        not(inArray(taskAttempts.status, ['queued', 'running'])),
        isNull(pipelineRuns.id),
        isNull(projects.id),
        ne(pipelineRuns.executionEpoch, projects.executionEpoch),
      ),
    ))
  for (const row of rows) {
    await terminalizeInvocation(database, row, 'orphaned_after_provider_start')
  }
  return [...managedIds, ...rows.map(({ invocationId }) => invocationId)]
}

export async function finalizeStoppedAiInvocationsInDatabase(
  database: Db,
  attemptIds: string[],
): Promise<string[]> {
  if (attemptIds.length === 0) return []
  const rows = await database.select({
    workspaceId: aiInvocations.workspaceId,
    invocationId: aiInvocations.id,
    billingStatus: aiInvocations.billingStatus,
    providerStartedAt: aiInvocations.providerStartedAt,
    capability: aiInvocations.capability,
  }).from(aiInvocations).where(and(
    inArray(aiInvocations.attemptId, attemptIds),
    eq(aiInvocations.status, 'running'),
  ))
  for (const row of rows) {
    await terminalizeInvocation(database, row, 'stopped_after_provider_start')
  }
  return rows.map(({ invocationId }) => invocationId)
}

async function terminalizeInvocation(
  database: Db,
  row: RecoverableInvocation,
  startedFailureKind: 'orphaned_after_provider_start' | 'stopped_after_provider_start',
): Promise<void> {
  const started = row.providerStartedAt !== null
  if (row.billingStatus === 'reserved') {
    await settleManagedInvocationInDatabase(database, {
      workspaceId: row.workspaceId,
      invocationId: row.invocationId,
      actualCostCnyMicros: BigInt(0),
      usageStatus: started ? 'unavailable' : 'reported',
      measurementQuality: started ? 'estimated' : 'reported',
      invocationStatus: started ? 'failed' : 'cancelled',
      billingStatus: started ? 'settled' : 'released',
      failureKind: started ? startedFailureKind : undefined,
      settleReservedMaximum: started,
    })
    return
  }
  if (row.billingStatus === 'not_applicable') {
    await database.update(aiInvocations).set({
      status: started ? 'failed' : 'cancelled',
      usageStatus: started ? 'unavailable' : undefined,
      measurementQuality: started ? 'uncertain' : undefined,
      usage: started
        ? {
            schemaVersion: 3,
            capability: row.capability ?? 'workflow',
            unavailable: true,
            reconciliation: startedFailureKind,
          }
        : undefined,
      failureKind: started ? startedFailureKind : undefined,
      providerCompletedAt: started ? sql`now()` : undefined,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(aiInvocations.workspaceId, row.workspaceId),
      eq(aiInvocations.id, row.invocationId),
      eq(aiInvocations.status, 'running'),
      started
        ? isNotNull(aiInvocations.providerStartedAt)
        : isNull(aiInvocations.providerStartedAt),
    ))
    return
  }
  await database.update(aiInvocations).set({
    status: started ? 'failed' : 'cancelled',
    usageStatus: started ? 'unavailable' : undefined,
    measurementQuality: started ? 'uncertain' : undefined,
    failureKind: started ? startedFailureKind : undefined,
    providerCompletedAt: started ? sql`now()` : undefined,
    completedAt: sql`now()`,
    updatedAt: sql`now()`,
  }).where(and(
    eq(aiInvocations.workspaceId, row.workspaceId),
    eq(aiInvocations.id, row.invocationId),
    eq(aiInvocations.status, 'running'),
  ))
}
