import { and, eq, gt, lte, ne, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema/core'
import {
  aiInvocations,
  pipelineRuns,
  taskAttempts,
  usagePeriods,
} from '@/lib/db/schema/index'
import { QuotaExhaustedError } from './contracts'

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
    capability?: 'text' | 'vision' | 'tts' | 'asr'
    operation?: string
    source?: string
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
    const [updated] = await tx.update(usagePeriods).set({
      reservedCnyMicros: sql`${usagePeriods.reservedCnyMicros} + ${input.maximumCostCnyMicros}`,
      updatedAt: now,
    }).where(and(
      eq(usagePeriods.workspaceId, workspaceId),
      eq(usagePeriods.id, period.id),
      lte(
        sql`${usagePeriods.usedCnyMicros} + ${usagePeriods.reservedCnyMicros} + ${input.maximumCostCnyMicros}`,
        usagePeriods.limitCnyMicros,
      ),
    )).returning({ id: usagePeriods.id })
    if (!updated) throw new QuotaExhaustedError(period.endsAt.toISOString())
    await tx.update(aiInvocations).set({
      usagePeriodId: period.id,
      rateCardId: input.rateCardId,
      billingIdempotencyKey: input.idempotencyKey,
      billingStatus: 'reserved',
      reservedCnyMicros: input.maximumCostCnyMicros,
      updatedAt: now,
    }).where(and(
      eq(aiInvocations.workspaceId, workspaceId),
      eq(aiInvocations.id, input.invocationId),
    ))
    return { periodId: period.id, reservedCnyMicros: input.maximumCostCnyMicros }
  })
}

export async function settleManagedInvocation(input: {
  workspaceId?: string
  invocationId: string
  actualCostCnyMicros: bigint
  usageStatus: 'reported' | 'unavailable'
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
    const settled = input.usageStatus === 'unavailable'
      ? invocation.reservedCnyMicros
      : input.actualCostCnyMicros
    if (settled < BigInt(0) || settled > invocation.reservedCnyMicros) {
      throw new Error('settled cost exceeds reservation')
    }
    const now = new Date()
    await tx.update(usagePeriods).set({
      reservedCnyMicros: sql`${usagePeriods.reservedCnyMicros} - ${invocation.reservedCnyMicros}`,
      usedCnyMicros: sql`${usagePeriods.usedCnyMicros} + ${settled}`,
      updatedAt: now,
    }).where(and(
      eq(usagePeriods.workspaceId, workspaceId),
      eq(usagePeriods.id, invocation.usagePeriodId),
    ))
    await tx.update(aiInvocations).set({
      billingStatus: input.billingStatus ?? 'settled',
      status: input.invocationStatus ?? 'succeeded',
      settledCnyMicros: settled,
      usage: input.usage,
      usageStatus: input.usageStatus,
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

export async function failManagedInvocation(input: {
  workspaceId?: string
  invocationId: string
}): Promise<void> {
  await settleManagedInvocation({
    ...input,
    actualCostCnyMicros: BigInt(0),
    usageStatus: 'unavailable',
    invocationStatus: 'failed',
  })
}

export const settleUsageUnavailable = failManagedInvocation

/**
 * 补偿父 attempt 已终态、但仍占用托管额度的调用。
 *
 * Provider 是否已经产生用量在进程中断后不可证明，因此按既有
 * usageStatus=unavailable 合同以最大预留结算；重复执行是幂等 no-op。
 */
export async function reconcileOrphanedManagedInvocations(): Promise<string[]> {
  const database = await getDb()
  const rows = await database
    .select({
      workspaceId: aiInvocations.workspaceId,
      invocationId: aiInvocations.id,
    })
    .from(aiInvocations)
    .innerJoin(
      taskAttempts,
      and(
        eq(taskAttempts.workspaceId, aiInvocations.workspaceId),
        eq(taskAttempts.id, aiInvocations.attemptId),
      ),
    )
    .where(
      and(
        eq(aiInvocations.status, 'running'),
        eq(aiInvocations.billingStatus, 'reserved'),
        ne(taskAttempts.status, 'running'),
      ),
    )
  for (const row of rows) {
    await failManagedInvocation({
      workspaceId: row.workspaceId,
      invocationId: row.invocationId,
    })
  }
  return rows.map((row) => row.invocationId)
}

export async function releaseManagedReservation(input: {
  workspaceId?: string
  invocationId: string
}): Promise<void> {
  await settleManagedInvocation({
    ...input,
    actualCostCnyMicros: BigInt(0),
    usageStatus: 'reported',
    invocationStatus: 'cancelled',
    billingStatus: 'released',
  })
}
