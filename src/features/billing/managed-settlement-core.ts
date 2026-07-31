import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema/core'
import {
  aiInvocations,
  billingReservations,
  entitlementLedgerEntries,
  managedModelCatalog,
  officialCostEntries,
  rateCards,
  serviceMultiplierCards,
  usagePeriods,
} from '@/lib/db/schema'
import { applyBillingRatio, divideBillingRoundUp } from './billing-math'

export interface ManagedInvocationSettlement {
  workspaceId: string
  invocationId: string
  actualCostCnyMicros: bigint
  usageStatus: 'reported' | 'unavailable'
  measurementQuality?: 'reported' | 'estimated' | 'uncertain'
  usage?: VersionedPayload
  invocationStatus?: 'succeeded' | 'failed' | 'cancelled'
  outputHash?: string
  billingStatus?: 'settled' | 'released'
  providerDurationMs?: number
  failureKind?: string
  settleReservedMaximum?: boolean
}

export async function settleManagedInvocationInDatabase(
  database: Db,
  input: ManagedInvocationSettlement,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [invocation] = await tx.select().from(aiInvocations).where(and(
      eq(aiInvocations.workspaceId, input.workspaceId),
      eq(aiInvocations.id, input.invocationId),
    )).for('update')
    if (!invocation) throw new Error('AI invocation does not exist')
    if (['settled', 'released'].includes(invocation.billingStatus)) return
    if (invocation.billingStatus !== 'reserved' || !invocation.usagePeriodId) {
      throw new Error('AI invocation is not reserved')
    }
    const measurementQuality = input.measurementQuality
      ?? (input.usageStatus === 'reported' ? 'reported' : 'uncertain')
    const billingStatus = input.settleReservedMaximum
      ? 'settled'
      : measurementQuality === 'uncertain'
      ? 'released'
      : input.billingStatus ?? 'settled'
    const [card] = invocation.rateCardId
      ? await tx.select({
          priceCurrency: rateCards.priceCurrency,
          fxCnyMicrosPerCurrencyUnit: rateCards.fxCnyMicrosPerCurrencyUnit,
          fxRateVersion: rateCards.fxRateVersion,
          officialPriceIdentity: rateCards.officialPriceIdentity,
          provider: managedModelCatalog.provider,
          model: managedModelCatalog.model,
        }).from(rateCards).innerJoin(
          managedModelCatalog,
          eq(rateCards.catalogId, managedModelCatalog.id),
        ).where(eq(rateCards.id, invocation.rateCardId)).limit(1)
      : []
    const serviceMultiplierId = invocation.entitlementRateCardId
      ?? multiplierId(invocation.capability ?? 'text')
    const [multiplier] = await tx.select().from(serviceMultiplierCards)
      .where(eq(serviceMultiplierCards.id, serviceMultiplierId))
      .limit(1)
    if (!card || !multiplier) throw new Error('immutable billing snapshot is missing')
    const settled = input.settleReservedMaximum
      ? invocation.reservedCnyMicros
      : billingStatus === 'released'
      ? BigInt(0)
      : applyBillingRatio(
          input.actualCostCnyMicros,
          multiplier.numerator,
          multiplier.denominator,
        )
    if (settled < BigInt(0) || settled > invocation.reservedCnyMicros) {
      throw new Error('settled entitlement debit exceeds reservation')
    }
    await tx.update(usagePeriods).set({
      reservedCnyMicros: sql`${usagePeriods.reservedCnyMicros} - ${invocation.reservedCnyMicros}`,
      usedCnyMicros: sql`${usagePeriods.usedCnyMicros} + ${settled}`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(usagePeriods.workspaceId, input.workspaceId),
      eq(usagePeriods.id, invocation.usagePeriodId),
    ))
    if (invocation.providerStartedAt) {
      const cnyMicros = measurementQuality === 'uncertain'
        || input.settleReservedMaximum
        ? null
        : input.actualCostCnyMicros
      await tx.insert(officialCostEntries).values({
        workspaceId: input.workspaceId,
        invocationId: invocation.id,
        rateCardId: invocation.rateCardId!,
        officialPriceIdentity: invocation.officialPriceIdentity
          ?? card.officialPriceIdentity
          ?? `${card.provider}.${card.model}`,
        currency: card.priceCurrency,
        sourceAmountMicros: cnyMicros === null
          ? null
          : divideBillingRoundUp(
              cnyMicros * BigInt(1_000_000),
              card.fxCnyMicrosPerCurrencyUnit,
            ),
        fxRateVersion: card.fxRateVersion,
        cnyMicros,
        measurementQuality,
        usage: input.usage,
      }).onConflictDoNothing()
    }
    await tx.insert(entitlementLedgerEntries).values({
      workspaceId: input.workspaceId,
      invocationId: invocation.id,
      usagePeriodId: invocation.usagePeriodId,
      serviceMultiplierId,
      multiplierNumerator: multiplier.numerator,
      multiplierDenominator: multiplier.denominator,
      debitCnyMicros: settled,
      entryType: measurementQuality === 'uncertain'
        ? 'uncertain'
        : billingStatus === 'released' ? 'release' : 'debit',
      idempotencyKey: `${invocation.billingIdempotencyKey}:terminal`,
    }).onConflictDoNothing()
    await tx.update(billingReservations).set({
      status: measurementQuality === 'uncertain'
        ? 'uncertain'
        : billingStatus === 'released' ? 'released' : 'settled',
      finalizedAt: sql`now()`,
    }).where(and(
      eq(billingReservations.workspaceId, input.workspaceId),
      eq(billingReservations.invocationId, invocation.id),
      eq(billingReservations.status, 'reserved'),
    ))
    await tx.update(aiInvocations).set({
      billingStatus,
      status: input.invocationStatus ?? 'succeeded',
      settledCnyMicros: settled,
      usage: input.usage,
      usageStatus: input.usageStatus,
      measurementQuality,
      outputHash: input.outputHash,
      settledAt: sql`now()`,
      providerCompletedAt: invocation.providerStartedAt ? sql`now()` : undefined,
      providerDurationMs: input.providerDurationMs,
      failureKind: input.failureKind,
      completedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(and(
      eq(aiInvocations.workspaceId, input.workspaceId),
      eq(aiInvocations.id, input.invocationId),
    ))
  })
}

function multiplierId(capability: string): string {
  return capability === 'workflow'
    ? 'workflow.video.v1'
    : `ai.${capability}.v1`
}
