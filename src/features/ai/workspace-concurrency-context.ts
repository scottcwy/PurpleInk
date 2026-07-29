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
  _workspaceId?: string,
): Promise<Date> {
  const [row] = await transaction
    .execute(sql`SELECT now() AS "ts"`)
  const raw: unknown = (row as Record<string, unknown> | undefined)?.ts
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
  if (typeof raw === 'string') {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  // 兜底：无论查询返回何种格式，保证调用方总能拿到可序列化的 Date。
  return new Date()
}

function isPlanKey(value: string | undefined): value is PlanKey {
  return value === 'free' || value === 'plus' || value === 'pro' || value === 'max'
}
