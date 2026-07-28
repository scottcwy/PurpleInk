import { createHash, createHmac } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { currentUserId, currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  redemptionAudits,
  redemptionBatches,
  redemptionCodes,
  usagePeriods,
  workspaceEntitlements,
  workspaceMembers,
} from '@/lib/db/schema/index'
import {
  BillingIdempotencyConflictError,
  type BillingProjection,
} from './contracts'
import {
  PLAN_DEFINITIONS,
  nextRollingPeriod,
  resolveRedemptionTransition,
  type PlanKey,
} from './domain'
import { getBillingProjection } from './period-service'

export type RedemptionResult =
  | { ok: true; projection: BillingProjection }
  | { ok: false; code: 'redemption_unavailable' | 'lower_tier' | 'forbidden' }

export interface RedeemBillingCodeInput {
  code: string
  idempotencyKey: string
  workspaceId?: string
  userId?: string
}

function redemptionPepper(): string {
  const pepper = process.env.CVC_REDEMPTION_CODE_PEPPER?.trim()
  if (!pepper) throw new Error('CVC_REDEMPTION_CODE_PEPPER is required')
  return pepper
}

export function hashRedemptionCode(code: string): string {
  return createHmac('sha256', redemptionPepper())
    .update('purpleink:redemption-code:v1\0')
    .update(code.trim().toUpperCase())
    .digest('hex')
}

function requestFingerprint(codeHash: string): string {
  return createHash('sha256')
    .update('purpleink:redemption-request:v1\0')
    .update(codeHash)
    .digest('hex')
}

export async function redeemBillingCode(
  input: RedeemBillingCodeInput,
): Promise<RedemptionResult> {
  const database = await getDb()
  const workspaceId = input.workspaceId ?? currentWorkspaceId()
  const userId = input.userId ?? currentUserId()
  const now = new Date()
  const codeHash = hashRedemptionCode(input.code)
  const fingerprint = requestFingerprint(codeHash)
  const outcome = await database.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${workspaceId}:${input.idempotencyKey}`}, 0)
      )
    `)
    const [membership] = await tx.select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ))
      .limit(1)
    if (membership?.role !== 'owner') return 'forbidden'
    const [previous] = await tx.select().from(redemptionAudits).where(and(
      eq(redemptionAudits.workspaceId, workspaceId),
      eq(redemptionAudits.idempotencyKey, input.idempotencyKey),
    )).for('update')
    if (previous) {
      if (previous.requestFingerprint !== fingerprint) {
        throw new BillingIdempotencyConflictError()
      }
      return previous.result
    }

    let [entitlement] = await tx.select().from(workspaceEntitlements).where(
      eq(workspaceEntitlements.workspaceId, workspaceId),
    ).for('update')
    if (!entitlement) {
      const period = nextRollingPeriod(now)
      ;[entitlement] = await tx.insert(workspaceEntitlements).values({
        workspaceId,
        planKey: 'free',
        startsAt: period.startsAt,
        expiresAt: period.endsAt,
        status: 'active',
        source: 'default',
      }).returning()
      await tx.insert(usagePeriods).values({
        workspaceId,
        planKey: 'free',
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        limitCnyMicros: PLAN_DEFINITIONS.free.limitCnyMicros,
      })
    }

    const [match] = await tx
      .select({ code: redemptionCodes, batch: redemptionBatches })
      .from(redemptionCodes)
      .innerJoin(redemptionBatches, eq(redemptionCodes.batchId, redemptionBatches.id))
      .where(and(
        eq(redemptionCodes.codeHash, codeHash),
        isNull(redemptionCodes.consumedAt),
        isNull(redemptionBatches.revokedAt),
      ))
      .for('update')
    const unavailable = !match
      || (match.batch.expiresAt !== null && match.batch.expiresAt <= now)
    if (unavailable) {
      await tx.insert(redemptionAudits).values({
        workspaceId,
        actorUserId: userId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        result: 'unavailable',
        beforePlanKey: entitlement.planKey,
        beforeExpiresAt: entitlement.expiresAt,
      })
      return 'unavailable'
    }

    const transition = resolveRedemptionTransition({
      currentPlan: entitlement.planKey as PlanKey,
      currentEndsAt: entitlement.expiresAt,
      redeemedPlan: match.batch.planKey as PlanKey,
      now,
    })
    if (transition.kind === 'reject-lower-tier') {
      await tx.insert(redemptionAudits).values({
        workspaceId,
        codeId: match.code.id,
        actorUserId: userId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        result: 'rejected_lower_tier',
        beforePlanKey: entitlement.planKey,
        afterPlanKey: entitlement.planKey,
        beforeExpiresAt: entitlement.expiresAt,
        afterExpiresAt: entitlement.expiresAt,
      })
      return 'rejected_lower_tier'
    }

    if (transition.kind !== 'extend') {
      await tx.update(usagePeriods).set({
        status: 'closed',
        updatedAt: now,
      }).where(and(
        eq(usagePeriods.workspaceId, workspaceId),
        eq(usagePeriods.status, 'active'),
        gt(usagePeriods.endsAt, now),
      ))
      const period = nextRollingPeriod(now)
      await tx.insert(usagePeriods).values({
        workspaceId,
        planKey: transition.plan,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        limitCnyMicros: PLAN_DEFINITIONS[transition.plan].limitCnyMicros,
      })
    }
    await tx.update(workspaceEntitlements).set({
      planKey: transition.plan,
      startsAt: transition.kind === 'extend' ? entitlement.startsAt : transition.startsAt,
      expiresAt: transition.entitlementExpiresAt,
      status: 'active',
      source: 'redemption',
      revision: entitlement.revision + BigInt(1),
      updatedAt: now,
    }).where(eq(workspaceEntitlements.workspaceId, workspaceId))
    await tx.update(redemptionCodes).set({
      consumedByWorkspaceId: workspaceId,
      consumedAt: now,
    }).where(eq(redemptionCodes.id, match.code.id))
    await tx.insert(redemptionAudits).values({
      workspaceId,
      codeId: match.code.id,
      actorUserId: userId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      result: 'redeemed',
      beforePlanKey: entitlement.planKey,
      afterPlanKey: transition.plan,
      beforeExpiresAt: entitlement.expiresAt,
      afterExpiresAt: transition.entitlementExpiresAt,
    })
    return 'redeemed'
  })
  if (outcome === 'unavailable') {
    return { ok: false, code: 'redemption_unavailable' }
  }
  if (outcome === 'rejected_lower_tier') {
    return { ok: false, code: 'lower_tier' }
  }
  if (outcome === 'forbidden') return { ok: false, code: 'forbidden' }
  return { ok: true, projection: await getBillingProjection() }
}
