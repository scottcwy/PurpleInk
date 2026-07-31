import 'server-only'
import { and, eq, gt, lte } from 'drizzle-orm'
import type { PlanKey } from '@/features/billing/domain'
import type { Db } from '@/lib/db/client'
import { readDatabaseClock } from '@/lib/db/database-clock'
import { workspaceEntitlements } from '@/lib/db/schema'

export type ConcurrencyTransaction =
  Parameters<Parameters<Db['transaction']>[0]>[0]

export async function activePlan(
  transaction: ConcurrencyTransaction,
  workspaceId: string,
  now: Date,
): Promise<PlanKey> {
  const [entitlement] = await transaction
    .select({ planKey: workspaceEntitlements.planKey })
    .from(workspaceEntitlements)
    .where(and(
      eq(workspaceEntitlements.workspaceId, workspaceId),
      eq(workspaceEntitlements.status, 'active'),
      lte(workspaceEntitlements.startsAt, now),
      gt(workspaceEntitlements.expiresAt, now),
    ))
    .limit(1)
  return isPlanKey(entitlement?.planKey) ? entitlement.planKey : 'free'
}

export async function databaseNow(
  transaction: ConcurrencyTransaction,
  _workspaceId?: string,
): Promise<Date> {
  return readDatabaseClock(transaction)
}

function isPlanKey(value: string | undefined): value is PlanKey {
  return value === 'free' || value === 'plus' || value === 'pro' || value === 'max'
}
