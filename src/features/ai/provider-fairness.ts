import { and, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { pipelineRuns, taskAttempts } from '@/lib/db/schema'

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

/** 是否已有另一位实际发起用户在同一供应商池等待。 */
export async function hasWaitingProviderPeer(
  transaction: Transaction,
  scopeKey: string,
  actorUserId: string,
): Promise<boolean> {
  const [peer] = await transaction
    .select({ id: taskAttempts.id })
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
      ne(pipelineRuns.requestedByUserId, actorUserId),
      sql`${taskAttempts.checkpoint} #>> '{queueMeta,providerScopeKey}' = ${scopeKey}`,
    ))
    .limit(1)
  return peer !== undefined
}
