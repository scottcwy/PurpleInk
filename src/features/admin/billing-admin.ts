import 'server-only'
import { desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { PLAN_DEFINITIONS, PLAN_KEYS, type PlanKey } from '@/features/billing'
import { redemptionBatches, redemptionCodes, workspaceEntitlements } from '@/lib/db/schema/index'

/**
 * 订阅计费管理查询（/admin/billing 消费）：套餐分布 + 兑换码批次列表。
 *
 * 只读跨 workspace 聚合，不展示单 workspace 明细。兑换码明文永不落库，
 * 这里只统计已用/总数比例。
 */

export const REDEMPTION_BATCHES_PAGE_SIZE_MAX = 100

export interface PlanDistributionItem {
  planKey: PlanKey
  displayName: string
  activeWorkspaces: number
}

export async function getBillingOverview(): Promise<{ plans: PlanDistributionItem[] }> {
  const database = await getDb()
  const rows = await database
    .select({
      planKey: workspaceEntitlements.planKey,
      active: sql<number>`count(*)::int`,
    })
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.status, 'active'))
    .groupBy(workspaceEntitlements.planKey)

  const byPlan = new Map(rows.map((row) => [row.planKey, row.active]))
  const plans = PLAN_KEYS.map((planKey) => ({
    planKey,
    displayName: PLAN_DEFINITIONS[planKey].displayName,
    activeWorkspaces: byPlan.get(planKey) ?? 0,
  }))
  return { plans }
}

export interface RedemptionBatchListItem {
  id: string
  label: string
  planKey: string
  durationDays: number
  totalCodes: number
  consumedCodes: number
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export interface RedemptionBatchList {
  batches: RedemptionBatchListItem[]
  total: number
  page: number
  pageSize: number
}

export async function listRedemptionBatches(input: {
  page: number
  pageSize: number
}): Promise<RedemptionBatchList> {
  const database = await getDb()
  const pageSize = Math.min(Math.max(input.pageSize, 1), REDEMPTION_BATCHES_PAGE_SIZE_MAX)
  const page = Math.max(input.page, 1)

  const [batches, counted] = await Promise.all([
    database
      .select({
        id: redemptionBatches.id,
        label: redemptionBatches.label,
        planKey: redemptionBatches.planKey,
        durationDays: redemptionBatches.durationDays,
        expiresAt: redemptionBatches.expiresAt,
        revokedAt: redemptionBatches.revokedAt,
        createdAt: redemptionBatches.createdAt,
        totalCodes: sql<number>`count(${redemptionCodes.id})::int`,
        consumedCodes: sql<number>`count(${redemptionCodes.consumedAt})::int`,
      })
      .from(redemptionBatches)
      .leftJoin(redemptionCodes, eq(redemptionCodes.batchId, redemptionBatches.id))
      .groupBy(redemptionBatches.id)
      .orderBy(desc(redemptionBatches.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database
      .select({ total: sql<number>`count(*)::int` })
      .from(redemptionBatches),
  ])

  return {
    batches,
    total: counted[0]?.total ?? 0,
    page,
    pageSize,
  }
}
