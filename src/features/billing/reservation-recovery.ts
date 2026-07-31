import 'server-only'
import { getDb } from '@/lib/db/client'
import { settleManagedInvocation } from './ledger'
import { reconcileOrphanedManagedInvocationsInDatabase } from './reservation-recovery-core'

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
 * 父 attempt 已终态但调用仍在运行时，按 Provider 是否已经开始分流：
 * 未出网释放预留；已出网但拿不到用量时，按最大预留合同结算。
 */
export async function reconcileOrphanedManagedInvocations(): Promise<string[]> {
  const database = await getDb()
  return reconcileOrphanedManagedInvocationsInDatabase(database)
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
