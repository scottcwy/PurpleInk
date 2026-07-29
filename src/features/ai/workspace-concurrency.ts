import 'server-only'
import { and, asc, eq, gt, lte, max, sql } from 'drizzle-orm'
import type { PlanKey } from '@/features/billing/domain'
import { subscriptionConcurrencyLimit } from '@/features/billing/domain'
import type { Db } from '@/lib/db/client'
import {
  workflowConcurrencyLeases,
  workspaceEntitlements,
} from '@/lib/db/schema'

const SHOT_STAGGER_MS = 500
const SLOT_LEASE_MS = 20 * 60_000
const RECONCILE_MS = 1_000

export interface WorkflowSlotInput {
  workspaceId: string
  actorUserId: string | null
  projectId: string
  workUnitKey: string
  database: Db
  now?: Date
}

export type WorkflowSlotDecision = {
  status: 'active' | 'waiting'
  limit: number
  active: number
  waiting: number
  resumeAt?: Date
  leaseExpiresAt?: Date
}

/** 原子申请 workspace 级分镜槽；同一 workUnitKey 重入只续租，不重复计数。 */
export async function tryAcquireWorkflowSlot(
  input: WorkflowSlotInput,
): Promise<WorkflowSlotDecision> {
  return input.database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`workflow-concurrency:${input.workspaceId}`}, 0)
      )
    `)
    const now = input.now ?? await databaseNow(transaction, input.workspaceId)
    await transaction
      .update(workflowConcurrencyLeases)
      .set({ status: 'expired', releasedAt: now, updatedAt: now })
      .where(and(
        eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
        eq(workflowConcurrencyLeases.status, 'active'),
        lte(workflowConcurrencyLeases.leaseExpiresAt, now),
      ))
    const planKey = await activePlan(transaction, input.workspaceId, now)
    const limit = subscriptionConcurrencyLimit(planKey)
    const [existing] = await transaction
      .select()
      .from(workflowConcurrencyLeases)
      .where(and(
        eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
        eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
      ))
      .limit(1)
      .for('update')
    const leaseExpiresAt = new Date(now.getTime() + SLOT_LEASE_MS)
    if (existing?.status === 'active') {
      await transaction
        .update(workflowConcurrencyLeases)
        .set({ leaseExpiresAt, updatedAt: now })
        .where(and(
          eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
          eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
        ))
      return decisionCounts(transaction, input.workspaceId, limit, {
        status: 'active',
        leaseExpiresAt,
      })
    }
    if (existing) {
      await transaction
        .update(workflowConcurrencyLeases)
        .set({
          actorUserId: input.actorUserId,
          projectId: input.projectId,
          planKey,
          status: 'waiting',
          requestedAt: now,
          notBefore: now,
          activatedAt: null,
          leaseExpiresAt: null,
          releasedAt: null,
          updatedAt: now,
        })
        .where(and(
          eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
          eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
        ))
    } else {
      await transaction.insert(workflowConcurrencyLeases).values({
        workspaceId: input.workspaceId,
        workUnitKey: input.workUnitKey,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        planKey,
        requestedAt: now,
        notBefore: now,
        updatedAt: now,
      })
    }
    const counts = await readCounts(transaction, input.workspaceId)
    if (counts.active >= limit) {
      return {
        status: 'waiting',
        limit,
        ...counts,
        resumeAt: new Date(now.getTime() + RECONCILE_MS),
      }
    }
    const [oldestWaiting] = await transaction
      .select({
        workUnitKey: workflowConcurrencyLeases.workUnitKey,
        notBefore: workflowConcurrencyLeases.notBefore,
      })
      .from(workflowConcurrencyLeases)
      .where(and(
        eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
        eq(workflowConcurrencyLeases.status, 'waiting'),
      ))
      .orderBy(
        asc(workflowConcurrencyLeases.requestedAt),
        asc(workflowConcurrencyLeases.workUnitKey),
      )
      .limit(1)
    if (oldestWaiting?.workUnitKey !== input.workUnitKey) {
      return {
        status: 'waiting',
        limit,
        ...counts,
        resumeAt: new Date(Math.max(
          oldestWaiting?.notBefore.getTime() ?? now.getTime(),
          now.getTime() + RECONCILE_MS,
        )),
      }
    }
    const [latest] = await transaction
      .select({
        activatedAt: max(workflowConcurrencyLeases.activatedAt),
      })
      .from(workflowConcurrencyLeases)
      .where(and(
        eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
        gt(workflowConcurrencyLeases.activatedAt, new Date(0)),
      ))
    const staggerUntil = latest?.activatedAt
      ? new Date(latest.activatedAt.getTime() + SHOT_STAGGER_MS)
      : now
    if (staggerUntil.getTime() > now.getTime()) {
      await transaction
        .update(workflowConcurrencyLeases)
        .set({ notBefore: staggerUntil, updatedAt: now })
        .where(and(
          eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
          eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
        ))
      return {
        status: 'waiting',
        limit,
        ...counts,
        resumeAt: staggerUntil,
      }
    }
    await transaction
      .update(workflowConcurrencyLeases)
      .set({
        status: 'active',
        planKey,
        activatedAt: now,
        leaseExpiresAt,
        updatedAt: now,
      })
      .where(and(
        eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
        eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
      ))
    return decisionCounts(transaction, input.workspaceId, limit, {
      status: 'active',
      leaseExpiresAt,
    })
  })
}

export async function releaseWorkflowSlot(input: {
  workspaceId: string
  workUnitKey: string
  outcome: 'released' | 'cancelled'
  database: Db
  now?: Date
}): Promise<void> {
  await input.database
    .update(workflowConcurrencyLeases)
    .set({
      status: input.outcome,
      releasedAt: input.now ?? new Date(),
      leaseExpiresAt: null,
      updatedAt: input.now ?? new Date(),
    })
    .where(and(
      eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
      eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
    ))
}

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

async function activePlan(
  transaction: Transaction,
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

async function databaseNow(
  transaction: Transaction,
  workspaceId: string,
): Promise<Date> {
  const [row] = await transaction
    .select({ now: sql<Date>`now()` })
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, workspaceId))
    .limit(1)
  return row?.now ?? new Date()
}

async function readCounts(
  transaction: Transaction,
  workspaceId: string,
): Promise<{ active: number; waiting: number }> {
  const [row] = await transaction
    .select({
      active: sql<number>`count(*) filter (
        where ${workflowConcurrencyLeases.status} = 'active'
      )::int`,
      waiting: sql<number>`count(*) filter (
        where ${workflowConcurrencyLeases.status} = 'waiting'
      )::int`,
    })
    .from(workflowConcurrencyLeases)
    .where(eq(workflowConcurrencyLeases.workspaceId, workspaceId))
  return { active: row?.active ?? 0, waiting: row?.waiting ?? 0 }
}

async function decisionCounts(
  transaction: Transaction,
  workspaceId: string,
  limit: number,
  decision: Pick<WorkflowSlotDecision, 'status' | 'leaseExpiresAt'>,
): Promise<WorkflowSlotDecision> {
  return { ...decision, limit, ...await readCounts(transaction, workspaceId) }
}

function isPlanKey(value: string | undefined): value is PlanKey {
  return value === 'free' || value === 'plus' || value === 'pro' || value === 'max'
}
