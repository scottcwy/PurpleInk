import { createHash, createHmac, randomInt } from 'node:crypto'
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

/** 可发放的套餐（free 无兑换意义，兑换目标只能是付费档）。 */
export const REDEEMABLE_PLAN_KEYS = ['plus', 'pro', 'max'] as const
export type RedeemablePlanKey = (typeof REDEEMABLE_PLAN_KEYS)[number]

/** 单批次最多生成的码数（防误操作刷爆表）。 */
export const REDEMPTION_BATCH_MAX = 1000

/** 明文码字母表：去掉 I/L/O 与 0/1 等易混字符，只留大写字母与 2-9。 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_SEGMENTS = 2
const CODE_SEGMENT_LEN = 4

export interface CreateRedemptionBatchInput {
  planKey: string
  count: number
  label: string
  durationDays?: number
  expiresAt?: Date | null
  createdByUserId?: string | null
}

export type CreateRedemptionBatchResult =
  | {
      ok: true
      batchId: string
      planKey: RedeemablePlanKey
      label: string
      /** 明文码仅本次返回，落库只存哈希，永不可回溯。 */
      codes: string[]
    }
  | { ok: false; code: 'invalid_plan' | 'invalid_count' | 'invalid_label' | 'invalid_duration' }

/** 生成 `PINK-XXXX-XXXX` 形态的明文码；randomInt 做无偏采样。 */
function generatePlaintextCode(): string {
  const segments: string[] = []
  for (let s = 0; s < CODE_SEGMENTS; s += 1) {
    let seg = ''
    for (let i = 0; i < CODE_SEGMENT_LEN; i += 1) {
      seg += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    }
    segments.push(seg)
  }
  return `PINK-${segments.join('-')}`
}

/**
 * 生成一个兑换码批次：单事务插入 `redemption_batches` + N 条 `redemption_codes`
 * （只存哈希）。明文码仅在返回值里出现一次，调用方负责一次性展示后即丢弃。
 */
export async function createRedemptionBatch(
  input: CreateRedemptionBatchInput,
): Promise<CreateRedemptionBatchResult> {
  const planKey = input.planKey as RedeemablePlanKey
  if (!REDEEMABLE_PLAN_KEYS.includes(planKey)) return { ok: false, code: 'invalid_plan' }
  if (
    !Number.isInteger(input.count)
    || input.count < 1
    || input.count > REDEMPTION_BATCH_MAX
  ) {
    return { ok: false, code: 'invalid_count' }
  }
  const label = input.label?.trim()
  if (!label) return { ok: false, code: 'invalid_label' }
  const durationDays = input.durationDays ?? 30
  if (durationDays !== 30) return { ok: false, code: 'invalid_duration' }

  // 批内去重生成明文码；跨批极小概率碰撞由 code_hash 唯一约束兜底。
  const plaintext = new Set<string>()
  while (plaintext.size < input.count) plaintext.add(generatePlaintextCode())
  const codes = [...plaintext]

  const database = await getDb()
  const batchId = await database.transaction(async (tx) => {
    const [batch] = await tx
      .insert(redemptionBatches)
      .values({
        planKey,
        durationDays,
        label,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning({ id: redemptionBatches.id })
    await tx.insert(redemptionCodes).values(
      codes.map((code) => ({ batchId: batch.id, codeHash: hashRedemptionCode(code) })),
    )
    return batch.id
  })
  return { ok: true, batchId, planKey, label, codes }
}

/** 按批次撤销：整批码随即不可兑换（redeem 查询已带 `isNull(revokedAt)` 过滤）。 */
export async function revokeRedemptionBatch(batchId: string): Promise<{ ok: boolean }> {
  const database = await getDb()
  const rows = await database
    .update(redemptionBatches)
    .set({ revokedAt: new Date() })
    .where(eq(redemptionBatches.id, batchId))
    .returning({ id: redemptionBatches.id })
  return { ok: rows.length > 0 }
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
