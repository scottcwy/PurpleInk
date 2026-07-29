import 'server-only'
import { and, eq, gt, lte, sql } from 'drizzle-orm'
import type { PlanKey } from '@/features/billing/domain'
import type { Db } from '@/lib/db/client'
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
  workspaceId: string,
): Promise<Date> {
  const [row] = await transaction
    .select({ now: sql<Date | string>`now()` })
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, workspaceId))
    .limit(1)
  if (!row) return new Date()
  return row.now instanceof Date ? row.now : new Date(row.now)
}

function isPlanKey(value: string | undefined): value is PlanKey {
  return value === 'free' || value === 'plus' || value === 'pro' || value === 'max'
}
