import { and, eq, gt, lte, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema/core'
import {
  aiInvocations,
  billingReservations,
  entitlementLedgerEntries,
  managedModelCatalog,
  officialCostEntries,
  pipelineRuns,
  rateCards,
  serviceMultiplierCards,
  taskAttempts,
  usagePeriods,
} from '@/lib/db/schema/index'
import { QuotaExhaustedError } from './contracts'
import { applyBillingRatio, divideBillingRoundUp } from './billing-math'
import type { BillingCapability } from './rate-card'

export interface ManagedInvocationReservation {
  workspaceId?: string
  invocationId: string
  idempotencyKey: string
  rateCardId: string
  maximumCostCnyMicros: bigint
  create?: {
    attemptId: string
    invocationNo: number
    repairNo?: number
    provider: string
    model: string
    inputHash: string
    capability?: BillingCapability
    operation?: string
    source?: string
    operationId?: string
    attemptGroupId?: string
    logicalModelId?: string
    outboundModelId?: string
    deploymentId?: string
    channelId?: string
    adapterProtocol?: string
    officialPriceIdentity?: string
    providerPoolId?: string
    failureDomainId?: string
    planVersion?: string
    entitlementRateCardId?: string
  }
}

function scopedWorkspace(explicit?: string): string {
  return explicit ?? currentWorkspaceId()
}

export async function reserveManagedInvocation(
  input: ManagedInvocationReservation,
): Promise<{ periodId: string; reservedCnyMicros: bigint }> {
  if (input.maximumCostCnyMicros < BigInt(0)) {
    throw new Error('maximumCostCnyMicros must not be negative')
  }
  const database = await getDb()
  const workspaceId = scopedWorkspace(input.workspaceId)
  return database.transaction(async (tx) => {
    let [invocation] = await tx.select().from(aiInvocations).where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.id, input.invocationId),
    )).for('update')
    if (!invocation && input.create) {
      const [attempt] = await tx.select({
        runId: taskAttempts.runId,
        taskId: taskAttempts.taskId,
        actorUserId: pipelineRuns.requestedByUserId,
      }).from(taskAttempts).innerJoin(
        pipelineRuns,
        and(
          eq(pipelineRuns.workspaceId, taskAttempts.workspaceId),
          eq(pipelineRuns.id, taskAttempts.runId),
        ),
      ).where(and(
        eq(taskAttempts.workspaceId, workspaceId),
        eq(taskAttempts.id, input.create.attemptId),
      )).for('update')
      if (!attempt) throw new Error('task attempt does not exist')
      ;[invocation] = await tx.insert(aiInvocations).values({
        workspaceId,
        id: input.invocationId,
        runId: attempt.runId,
        attemptId: input.create.attemptId,
        taskId: attempt.taskId,
        invocationNo: input.create.invocationNo,
        repairNo: input.create.repairNo ?? 0,
        provider: input.create.provider,
        model: input.create.model,
        operationId: input.create.operationId,
        attemptGroupId: input.create.attemptGroupId,
        logicalModelId: input.create.logicalModelId ?? input.create.model,
        outboundModelId: input.create.outboundModelId ?? input.create.model,
        deploymentId: input.create.deploymentId,
        channelId: input.create.channelId,
        adapterProtocol: input.create.adapterProtocol,
        officialPriceIdentity: input.create.officialPriceIdentity,
        providerPoolId: input.create.providerPoolId,
        failureDomainId: input.create.failureDomainId,
        planVersion: input.create.planVersion,
        entitlementRateCardId: input.create.entitlementRateCardId,
        actorUserId: attempt.actorUserId,
        funding: 'managed',
        capability: input.create.capability ?? 'text',
        operation: input.create.operation ?? 'workflow',
        source: input.create.source ?? 'products',
        telemetryVersion: 2,
        inputHash: input.create.inputHash,
      }).onConflictDoNothing().returning()
      if (!invocation) {
        ;[invocation] = await tx.select().from(aiInvocations).where(and(
          eq(aiInvocations.workspaceId, workspaceId),
          eq(aiInvocations.id, input.invocationId),
        )).for('update')
      }
    }
    if (!invocation) throw new Error('AI invocation does not exist')
    if (invocation.billingStatus !== 'unreserved') {
      if (invocation.billingIdempotencyKey !== input.idempotencyKey) {
        throw new Error('billing reservation idempotency conflict')
      }
      return {
        periodId: invocation.usagePeriodId!,
        reservedCnyMicros: invocation.reservedCnyMicros,
      }
    }
    const now = new Date()
    const [period] = await tx.select().from(usagePeriods).where(and(
      eq(usagePeriods.workspaceId, workspaceId),
      eq(usagePeriods.status, 'active'),
      lte(usagePeriods.startsAt, now),
      gt(usagePeriods.endsAt, now),
    )).limit(1).for('update')
    if (!period) throw new QuotaExhaustedError(now.toISOString())
    const serviceMultiplierId = input.create?.entitlementRateCardId
      ?? multiplierId(input.create?.capability ?? 'text')
    const [multiplier] = await tx.select().from(serviceMultiplierCards)
      .where(eq(serviceMultiplierCards.id, serviceMultiplierId))
      .limit(1)
    if (!multiplier) throw new Error('immutable service multiplier is missing')
    const entitlementMaximum = applyBillingRatio(
      input.maximumCostCnyMicros,
      multiplier.numerator,
      multiplier.denominator,
    )
    const [updated] = await tx.update(usagePeriods).set({
      reservedCnyMicros: sql`${usagePeriods.reservedCnyMicros} + ${entitlementMaximum}`,
      updatedAt: now,
    }).where(and(
      eq(usagePeriods.workspaceId, workspaceId),
      eq(usagePeriods.id, period.id),
      lte(
        sql`${usagePeriods.usedCnyMicros} + ${usagePeriods.reservedCnyMicros} + ${entitlementMaximum}`,
        usagePeriods.limitCnyMicros,
      ),
    )).returning({ id: usagePeriods.id })
    if (!updated) throw new QuotaExhaustedError(period.endsAt.toISOString())
    const [card] = await tx.select({
      officialPriceIdentity: rateCards.officialPriceIdentity,
      provider: managedModelCatalog.provider,
      model: managedModelCatalog.model,
    }).from(rateCards).innerJoin(
      managedModelCatalog,
      eq(rateCards.catalogId, managedModelCatalog.id),
    ).where(eq(rateCards.id, input.rateCardId)).limit(1)
    if (!card) throw new Error('billing rate card does not exist')
    await tx.update(aiInvocations).set({
      usagePeriodId: period.id,
      rateCardId: input.rateCardId,
      officialPriceIdentity: input.create?.officialPriceIdentity
        ?? card.officialPriceIdentity
        ?? `${card.provider}.${card.model}`,
      planVersion: input.create?.planVersion ?? period.planVersion,
      entitlementRateCardId: serviceMultiplierId,
      billingIdempotencyKey: input.idempotencyKey,
      billingStatus: 'reserved',
      reservedCnyMicros: entitlementMaximum,
      updatedAt: now,
    }).where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.id, input.invocationId),
    ))
    await tx.insert(billingReservations).values({
      workspaceId,
      invocationId: input.invocationId,
      usagePeriodId: period.id,
      maximumCnyMicros: entitlementMaximum,
      idempotencyKey: input.idempotencyKey,
    }).onConflictDoNothing()
    return { periodId: period.id, reservedCnyMicros: entitlementMaximum }
  })
}

export async function settleManagedInvocation(input: {
  workspaceId?: string
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
}): Promise<void> {
  const database = await getDb()
  const workspaceId = scopedWorkspace(input.workspaceId)
  await database.transaction(async (tx) => {
    const [invocation] = await tx.select().from(aiInvocations).where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.id, input.invocationId),
    )).for('update')
    if (!invocation) throw new Error('AI invocation does not exist')
    if (['settled', 'released'].includes(invocation.billingStatus)) return
    if (invocation.billingStatus !== 'reserved' || !invocation.usagePeriodId) {
      throw new Error('AI invocation is not reserved')
    }
    const measurementQuality = input.measurementQuality
      ?? (input.usageStatus === 'reported' ? 'reported' : 'uncertain')
    const billingStatus = measurementQuality === 'uncertain'
      ? 'released'
      : input.billingStatus ?? 'settled'
    const now = new Date()
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
    const settled = billingStatus === 'released'
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
      updatedAt: now,
    }).where(and(
      eq(usagePeriods.workspaceId, workspaceId),
      eq(usagePeriods.id, invocation.usagePeriodId),
    ))
    if (invocation.providerStartedAt) {
      const cnyMicros = measurementQuality === 'uncertain'
        ? null
        : input.actualCostCnyMicros
      await tx.insert(officialCostEntries).values({
        workspaceId,
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
      workspaceId,
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
      finalizedAt: now,
    }).where(and(
      eq(billingReservations.workspaceId, workspaceId),
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
      settledAt: now,
      providerCompletedAt: invocation.providerStartedAt ? now : undefined,
      providerDurationMs: input.providerDurationMs,
      failureKind: input.failureKind,
      completedAt: now,
      updatedAt: now,
    }).where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.id, input.invocationId),
    ))
  })
}

function multiplierId(capability: string): string {
  return capability === 'workflow'
    ? 'workflow.video.v1'
    : `ai.${capability}.v1`
}
