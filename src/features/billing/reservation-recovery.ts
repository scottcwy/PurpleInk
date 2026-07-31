import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { aiInvocations, taskAttempts } from '@/lib/db/schema/index'
import { settleManagedInvocation } from './ledger'

export async function failManagedInvocation(input: {
  workspaceId?: string
  invocationId: string
}): Promise<void> {
  await settleManagedInvocation({
    ...input,
    actualCostCnyMicros: BigInt(0),
    usageStatus: 'unavailable',
    measurementQuality: 'uncertain',
    invocationStatus: 'failed',
  })
}

export const settleUsageUnavailable = failManagedInvocation

/**
 * 父 attempt 已终态但调用仍在运行时，上游执行结果已不可证明。
 * 新合同记录 uncertain 并释放预留，不得把最大预留静默当作实际消费。
 */
export async function reconcileOrphanedManagedInvocations(): Promise<string[]> {
  const database = await getDb()
  const rows = await database
    .select({
      workspaceId: aiInvocations.workspaceId,
      invocationId: aiInvocations.id,
    })
    .from(aiInvocations)
    .innerJoin(
      taskAttempts,
      and(
        eq(taskAttempts.workspaceId, aiInvocations.workspaceId),
        eq(taskAttempts.id, aiInvocations.attemptId),
      ),
    )
    .where(
      and(
        eq(aiInvocations.status, 'running'),
        eq(aiInvocations.billingStatus, 'reserved'),
        ne(taskAttempts.status, 'running'),
      ),
    )
  for (const row of rows) {
    await failManagedInvocation({
      workspaceId: row.workspaceId,
      invocationId: row.invocationId,
    })
  }
  return rows.map((row) => row.invocationId)
}

export async function releaseManagedReservation(input: {
  workspaceId?: string
  invocationId: string
}): Promise<void> {
  await settleManagedInvocation({
    ...input,
    actualCostCnyMicros: BigInt(0),
    usageStatus: 'reported',
    measurementQuality: 'reported',
    invocationStatus: 'cancelled',
    billingStatus: 'released',
  })
}
