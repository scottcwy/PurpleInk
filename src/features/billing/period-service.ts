import { and, desc, eq, gt, lte, sql } from 'drizzle-orm'
import { currentUserId, currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import type { TransactionContext } from '@/lib/db/transaction'
import {
  aiInvocations,
  entitlementLedgerEntries,
  usagePeriods,
  workspaceEntitlements,
  workspaceMembers,
} from '@/lib/db/schema/index'
import {
  QuotaExhaustedError,
  createProviderCallCounts,
  isBuiltInProviderId,
  toBillingProjection,
  type BillingProjection,
} from './contracts'
import {
  nextRollingPeriod,
  usagePeriodPlanSnapshot,
  type PlanKey,
} from './domain'

export async function provisionFreeEntitlement(
  transaction: TransactionContext,
  workspaceId: string,
  now = new Date(),
): Promise<void> {
  const period = nextRollingPeriod(now)
  await transaction.insert(workspaceEntitlements).values({
    workspaceId,
    planKey: 'free',
    startsAt: period.startsAt,
    expiresAt: period.endsAt,
    status: 'active',
    source: 'default',
  })
  await transaction.insert(usagePeriods).values({
    workspaceId,
    ...usagePeriodPlanSnapshot('free'),
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  })
}

async function ensureCurrentPeriod(input: {
  database: Db
  workspaceId: string
  now: Date
}) {
  return input.database.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`billing-period:${input.workspaceId}`}, 0)
      )
    `)
    let [entitlement] = await tx.select().from(workspaceEntitlements).where(
      eq(workspaceEntitlements.workspaceId, input.workspaceId),
    ).for('update')
    let [period] = await tx.select().from(usagePeriods).where(and(
      eq(usagePeriods.workspaceId, input.workspaceId),
      eq(usagePeriods.status, 'active'),
      lte(usagePeriods.startsAt, input.now),
      gt(usagePeriods.endsAt, input.now),
    )).limit(1).for('update')
    if (period) return period
    await tx.update(usagePeriods).set({
      status: 'closed',
      updatedAt: input.now,
    }).where(and(
      eq(usagePeriods.workspaceId, input.workspaceId),
      eq(usagePeriods.status, 'active'),
    ))
    const rolling = nextRollingPeriod(input.now)
    if (!entitlement) {
      ;[entitlement] = await tx.insert(workspaceEntitlements).values({
        workspaceId: input.workspaceId,
        planKey: 'free',
        startsAt: rolling.startsAt,
        expiresAt: rolling.endsAt,
        status: 'active',
        source: 'default',
      }).returning()
    } else if (entitlement.expiresAt <= input.now || entitlement.status !== 'active') {
      ;[entitlement] = await tx.update(workspaceEntitlements).set({
        planKey: 'free',
        startsAt: rolling.startsAt,
        expiresAt: rolling.endsAt,
        status: 'active',
        source: 'default',
        revision: entitlement.revision + BigInt(1),
        updatedAt: input.now,
      }).where(eq(workspaceEntitlements.workspaceId, input.workspaceId)).returning()
    }
    const planKey = entitlement.planKey as PlanKey
    ;[period] = await tx.insert(usagePeriods).values({
      workspaceId: input.workspaceId,
      ...usagePeriodPlanSnapshot(planKey),
      startsAt: rolling.startsAt,
      endsAt: rolling.endsAt,
    }).returning()
    return period
  })
}

export async function ensureFreeEntitlement(input: {
  workspaceId: string
  now?: Date
  database?: Db
}): Promise<void> {
  const database = input.database ?? await getDb()
  await ensureCurrentPeriod({
    database,
    workspaceId: input.workspaceId,
    now: input.now ?? new Date(),
  })
}

export async function getBillingProjection(): Promise<BillingProjection> {
  const database = await getDb()
  const workspaceId = currentWorkspaceId()
  const period = await ensureCurrentPeriod({ database, workspaceId, now: new Date() })
  const invocations = await database.select({
    provider: aiInvocations.provider,
    usage: aiInvocations.usage,
    usageStatus: aiInvocations.usageStatus,
    measurementQuality: aiInvocations.measurementQuality,
    settledAt: aiInvocations.settledAt,
  }).from(entitlementLedgerEntries).innerJoin(
    aiInvocations,
    and(
      eq(aiInvocations.workspaceId, entitlementLedgerEntries.workspaceId),
      eq(aiInvocations.id, entitlementLedgerEntries.invocationId),
    ),
  ).where(and(
    eq(entitlementLedgerEntries.workspaceId, workspaceId),
    eq(entitlementLedgerEntries.usagePeriodId, period.id),
    eq(entitlementLedgerEntries.entryType, 'debit'),
  )).orderBy(desc(aiInvocations.settledAt))
  const providerCalls = createProviderCallCounts()
  let inputTokens = 0
  let outputTokens = 0
  for (const invocation of invocations) {
    if (isBuiltInProviderId(invocation.provider)) {
      providerCalls[invocation.provider] += 1
    }
    if (
      hasProjectedUsage(invocation)
      && invocation.usage
      && typeof invocation.usage.inputTokens === 'number'
    ) {
      inputTokens += invocation.usage.inputTokens
    }
    if (
      hasProjectedUsage(invocation)
      && invocation.usage
      && typeof invocation.usage.outputTokens === 'number'
    ) {
      outputTokens += invocation.usage.outputTokens
    }
  }
  const [membership] = await database.select({ role: workspaceMembers.role })
    .from(workspaceMembers).where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, currentUserId()),
    )).limit(1)
  return toBillingProjection({
    planKey: period.planKey as PlanKey,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    usedCnyMicros: period.usedCnyMicros,
    reservedCnyMicros: period.reservedCnyMicros,
    limitCnyMicros: period.limitCnyMicros,
    invocationCount: invocations.length,
    inputTokens,
    outputTokens,
    providerCalls,
    lastInvocationAt: invocations[0]?.settledAt ?? null,
    canRedeem: membership?.role === 'owner',
  })
}

function hasProjectedUsage(invocation: {
  usageStatus: string | null
  measurementQuality: string | null
}): boolean {
  return invocation.measurementQuality === 'reported'
    || invocation.measurementQuality === 'estimated'
    || (
      invocation.measurementQuality === null
      && invocation.usageStatus === 'reported'
    )
}

export async function getCurrentPlanKey(workspaceId?: string): Promise<PlanKey> {
  const database = await getDb()
  const period = await ensureCurrentPeriod({
    database,
    workspaceId: workspaceId ?? currentWorkspaceId(),
    now: new Date(),
  })
  return period.planKey as PlanKey
}

export async function assertBillingAvailable(workspaceId?: string): Promise<void> {
  const database = await getDb()
  const now = new Date()
  const period = await ensureCurrentPeriod({
    database,
    workspaceId: workspaceId ?? currentWorkspaceId(),
    now,
  })
  if (period.usedCnyMicros + period.reservedCnyMicros >= period.limitCnyMicros) {
    throw new QuotaExhaustedError(period.endsAt.toISOString())
  }
}

export async function assertBillingCapacity(
  requiredCnyMicros: bigint,
  workspaceId?: string,
): Promise<void> {
  if (requiredCnyMicros < BigInt(0)) {
    throw new Error('requiredCnyMicros must not be negative')
  }
  const database = await getDb()
  const now = new Date()
  const period = await ensureCurrentPeriod({
    database,
    workspaceId: workspaceId ?? currentWorkspaceId(),
    now,
  })
  const projected = period.usedCnyMicros
    + period.reservedCnyMicros
    + requiredCnyMicros
  if (projected > period.limitCnyMicros) {
    throw new QuotaExhaustedError(period.endsAt.toISOString())
  }
}
