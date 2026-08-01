import 'server-only'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { PLAN_DEFINITIONS, type PlanKey } from '@/features/billing'
import { generateRedemptionCode } from '@/features/billing/redemption-code'
import { hashRedemptionCode } from '@/features/billing/redemption'
import { getDb } from '@/lib/db/client'
import {
  entitlementLedgerEntries,
  officialCostEntries,
  redemptionBatches,
  redemptionCodes,
  workspaceEntitlements,
  workspaces,
} from '@/lib/db/schema'

type RedeemablePlan = Exclude<PlanKey, 'free'>

export class BillingAdminError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'BATCH_NOT_FOUND') {
    super(code === 'INVALID_INPUT' ? '兑换批次参数不正确' : '兑换批次不存在')
    this.name = 'BillingAdminError'
  }
}

export interface AdminBillingSnapshot {
  plans: Array<{
    key: PlanKey
    displayName: string
    version: string
    concurrency: number
    managedProviders: string[]
    limitCnyMicros: string
  }>
  entitlements: Array<{
    workspaceId: string
    workspaceName: string
    planKey: string
    status: string
    expiresAt: string
  }>
  ledgers: {
    officialCost: {
      totalCnyMicros: string | null
      knownCnyMicros: string
      entryCount: number
      knownEntryCount: number
      measurementQualities: string[]
    }
    entitlement: {
      totalDebitCnyMicros: string | null
      knownDebitCnyMicros: string
      entryCount: number
    }
  }
  batches: Array<{
    id: string
    label: string
    planKey: string
    expiresAt: string | null
    revokedAt: string | null
    createdAt: string
    totalCodes: number
    consumedCodes: number
  }>
  page: number
  pageSize: number
}

export async function getAdminBilling(input: {
  page?: number
  pageSize?: number
} = {}): Promise<AdminBillingSnapshot> {
  const database = await getDb()
  const page = positiveInteger(input.page, 1)
  const pageSize = Math.min(positiveInteger(input.pageSize, 50), 100)
  const [entitlements, officialLedger, entitlementLedger, batches] = await Promise.all([
    database.select({
      workspaceId: workspaceEntitlements.workspaceId,
      workspaceName: workspaces.name,
      planKey: workspaceEntitlements.planKey,
      status: workspaceEntitlements.status,
      expiresAt: workspaceEntitlements.expiresAt,
    }).from(workspaceEntitlements)
      .innerJoin(workspaces, eq(workspaceEntitlements.workspaceId, workspaces.id))
      .orderBy(desc(workspaceEntitlements.updatedAt))
      .limit(100),
    database.select({
      total: sql<string | null>`case
        when count(*) = 0 or count(${officialCostEntries.cnyMicros}) < count(*) then null
        else sum(${officialCostEntries.cnyMicros})::text
      end`,
      known: sql<string>`coalesce(sum(${officialCostEntries.cnyMicros}) filter (
        where ${officialCostEntries.cnyMicros} is not null
      ), 0)::text`,
      count: sql<number>`count(*)::int`,
      knownCount: sql<number>`count(${officialCostEntries.cnyMicros})::int`,
      qualities: sql<string[]>`coalesce(array_agg(distinct ${officialCostEntries.measurementQuality})
        filter (where ${officialCostEntries.measurementQuality} is not null), '{}')`,
    }).from(officialCostEntries),
    database.select({
      total: sql<string | null>`case when count(*) = 0 then null
        else sum(${entitlementLedgerEntries.debitCnyMicros})::text end`,
      known: sql<string>`coalesce(sum(${entitlementLedgerEntries.debitCnyMicros}), 0)::text`,
      count: sql<number>`count(*)::int`,
    }).from(entitlementLedgerEntries),
    database.select({
      id: redemptionBatches.id,
      label: redemptionBatches.label,
      planKey: redemptionBatches.planKey,
      expiresAt: redemptionBatches.expiresAt,
      revokedAt: redemptionBatches.revokedAt,
      createdAt: redemptionBatches.createdAt,
      totalCodes: sql<number>`count(${redemptionCodes.id})::int`,
      consumedCodes: sql<number>`count(${redemptionCodes.id}) filter (where ${redemptionCodes.consumedAt} is not null)::int`,
    }).from(redemptionBatches)
      .leftJoin(redemptionCodes, eq(redemptionCodes.batchId, redemptionBatches.id))
      .groupBy(redemptionBatches.id)
      .orderBy(desc(redemptionBatches.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])
  const officialTotals = officialLedger[0]
  const entitlementTotals = entitlementLedger[0]
  return {
    plans: (Object.values(PLAN_DEFINITIONS) as Array<(typeof PLAN_DEFINITIONS)[PlanKey]>).map(
      (plan) => ({
        key: plan.key,
        displayName: plan.displayName,
        version: plan.version,
        concurrency: plan.concurrency,
        managedProviders: [...plan.managedProviders],
        limitCnyMicros: String(plan.limitCnyMicros),
      }),
    ),
    entitlements: entitlements.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString() })),
    ledgers: {
      officialCost: {
        totalCnyMicros: officialTotals?.total ?? null,
        knownCnyMicros: officialTotals?.known ?? '0',
        entryCount: officialTotals?.count ?? 0,
        knownEntryCount: officialTotals?.knownCount ?? 0,
        measurementQualities: officialTotals?.qualities ?? [],
      },
      entitlement: {
        totalDebitCnyMicros: entitlementTotals?.total ?? null,
        knownDebitCnyMicros: entitlementTotals?.known ?? '0',
        entryCount: entitlementTotals?.count ?? 0,
      },
    },
    batches: batches.map((row) => ({
      ...row,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    page,
    pageSize,
  }
}

export async function createRedemptionBatch(input: {
  actorUserId: string
  planKey: RedeemablePlan
  label: string
  count: number
  expiresAt: Date | null
}): Promise<{ batchId: string; codes: string[] }> {
  validateBatchInput(input)
  const database = await getDb()
  const codes = Array.from({ length: input.count }, () => generateRedemptionCode(input.planKey))
  const [batch] = await database.transaction(async (tx) => {
    const created = await tx.insert(redemptionBatches).values({
      planKey: input.planKey,
      durationDays: 30,
      label: input.label.trim(),
      expiresAt: input.expiresAt,
      createdByUserId: input.actorUserId,
    }).returning({ id: redemptionBatches.id })
    await tx.insert(redemptionCodes).values(codes.map((code) => ({
      batchId: created[0]!.id,
      codeHash: hashRedemptionCode(code),
    })))
    return created
  })
  return { batchId: batch!.id, codes }
}

export async function revokeRedemptionBatch(input: { batchId: string }): Promise<void> {
  const database = await getDb()
  const rows = await database.update(redemptionBatches)
    .set({ revokedAt: sql`coalesce(${redemptionBatches.revokedAt}, now())` })
    .where(and(eq(redemptionBatches.id, input.batchId), isNull(redemptionBatches.revokedAt)))
    .returning({ id: redemptionBatches.id })
  if (rows.length === 0) {
    const [existing] = await database.select({ id: redemptionBatches.id })
      .from(redemptionBatches).where(eq(redemptionBatches.id, input.batchId))
    if (!existing) throw new BillingAdminError('BATCH_NOT_FOUND')
  }
}

function validateBatchInput(input: {
  planKey: string
  label: string
  count: number
  expiresAt: Date | null
}): void {
  if (
    !['plus', 'pro', 'max'].includes(input.planKey)
    || input.label.trim().length < 1
    || input.label.trim().length > 100
    || !Number.isSafeInteger(input.count)
    || input.count < 1
    || input.count > 1_000
    || (input.expiresAt !== null && input.expiresAt <= new Date())
  ) throw new BillingAdminError('INVALID_INPUT')
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback
}
