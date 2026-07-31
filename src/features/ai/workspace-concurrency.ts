import 'server-only'
import { and, eq, lte, max, sql } from 'drizzle-orm'
import { subscriptionConcurrencyLimit } from '@/features/billing/domain'
import type { Db } from '@/lib/db/client'
import { workflowConcurrencyLeases } from '@/lib/db/schema'
import {
  activePlan,
  type ConcurrencyTransaction,
  databaseNow,
} from './workspace-concurrency-context'
import { workspaceConcurrencyEnforced } from './concurrency-rollout'

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
  shadowWaitReason?: 'plan_limit'
}

/** 原子申请 workspace 级分镜槽；同一 workUnitKey 重入只续租，不重复计数。 */
export async function tryAcquireWorkflowSlot(
  input: WorkflowSlotInput,
): Promise<WorkflowSlotDecision> {
  return input.database.transaction((transaction) =>
    acquireWorkflowSlot(transaction, input))
}

export async function tryAcquireWorkflowSlotInTransaction(
  transaction: ConcurrencyTransaction,
  input: Omit<WorkflowSlotInput, 'database'>,
): Promise<WorkflowSlotDecision> {
  return acquireWorkflowSlot(transaction, input)
}

export async function registerWorkflowSlotsInTransaction(
  transaction: ConcurrencyTransaction,
  input: {
    workspaceId: string
    actorUserId: string | null
    projectId: string
    workUnitKeys: readonly string[]
    now?: Date
  },
): Promise<void> {
  if (input.workUnitKeys.length === 0) return
  const now = input.now ?? await databaseNow(transaction, input.workspaceId)
  const planKey = await activePlan(transaction, input.workspaceId, now)
  await transaction
    .insert(workflowConcurrencyLeases)
    .values(input.workUnitKeys.map((workUnitKey, index) => ({
      workspaceId: input.workspaceId,
      workUnitKey,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      planKey,
      requestedAt: now,
      notBefore: new Date(now.getTime() + index * SHOT_STAGGER_MS),
      updatedAt: now,
    })))
    .onConflictDoNothing()
}

async function acquireWorkflowSlot(
  transaction: ConcurrencyTransaction,
  input: Omit<WorkflowSlotInput, 'database'>,
): Promise<WorkflowSlotDecision> {
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
        eq(workflowConcurrencyLeases.projectId, input.projectId),
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
          eq(workflowConcurrencyLeases.projectId, input.projectId),
          eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
        ))
      return decisionCounts(transaction, input.workspaceId, limit, {
        status: 'active',
        leaseExpiresAt,
      })
    }
    if (existing?.status === 'waiting') {
      if (
        existing.actorUserId !== input.actorUserId
        || existing.projectId !== input.projectId
        || existing.planKey !== planKey
      ) {
        await transaction
          .update(workflowConcurrencyLeases)
          .set({
            actorUserId: input.actorUserId,
            projectId: input.projectId,
            planKey,
            updatedAt: now,
          })
          .where(and(
            eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
            eq(workflowConcurrencyLeases.projectId, input.projectId),
            eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
          ))
      }
    } else if (existing) {
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
          eq(workflowConcurrencyLeases.projectId, input.projectId),
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
    const queueState = await readQueueState(transaction, input.workspaceId)
    const counts = {
      active: queueState.active,
      waiting: queueState.waiting,
    }
    if (existing?.status === 'waiting' && existing.notBefore.getTime() > now.getTime()) {
      return {
        status: 'waiting',
        limit,
        ...counts,
        resumeAt: existing.notBefore,
      }
    }
    let shadowWaitReason: WorkflowSlotDecision['shadowWaitReason']
    if (counts.active >= limit) {
      if (workspaceConcurrencyEnforced(input.workspaceId)) {
        return {
          status: 'waiting',
          limit,
          ...counts,
          resumeAt: new Date(now.getTime() + RECONCILE_MS),
        }
      }
      shadowWaitReason = 'plan_limit'
    }
    const staggerUntil = queueState.latestActivatedAt
      ? new Date(queueState.latestActivatedAt.getTime() + SHOT_STAGGER_MS)
      : now
    if (staggerUntil.getTime() > now.getTime()) {
      await transaction
        .update(workflowConcurrencyLeases)
        .set({ notBefore: staggerUntil, updatedAt: now })
        .where(and(
          eq(workflowConcurrencyLeases.workspaceId, input.workspaceId),
          eq(workflowConcurrencyLeases.projectId, input.projectId),
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
        eq(workflowConcurrencyLeases.projectId, input.projectId),
        eq(workflowConcurrencyLeases.workUnitKey, input.workUnitKey),
      ))
    const decision: WorkflowSlotDecision = {
      status: 'active',
      limit,
      active: counts.active + 1,
      waiting: Math.max(0, counts.waiting - 1),
      leaseExpiresAt,
      ...(shadowWaitReason ? { shadowWaitReason } : {}),
    }
    console.info('[workflow_lane_admitted]', {
      projectId: input.projectId,
      workUnitKey: input.workUnitKey,
      active: decision.active,
      limit,
    })
    return decision
}

async function readCounts(
  transaction: ConcurrencyTransaction,
  workspaceId: string,
): Promise<{ active: number; waiting: number }> {
  const state = await readQueueState(transaction, workspaceId)
  return { active: state.active, waiting: state.waiting }
}

async function readQueueState(
  transaction: ConcurrencyTransaction,
  workspaceId: string,
): Promise<{
  active: number
  waiting: number
  latestActivatedAt: Date | null
}> {
  const [row] = await transaction
    .select({
      active: sql<number>`count(*) filter (
        where ${workflowConcurrencyLeases.status} = 'active'
      )::int`,
      waiting: sql<number>`count(*) filter (
        where ${workflowConcurrencyLeases.status} = 'waiting'
      )::int`,
      latestActivatedAt: max(workflowConcurrencyLeases.activatedAt),
    })
    .from(workflowConcurrencyLeases)
    .where(eq(workflowConcurrencyLeases.workspaceId, workspaceId))
  return {
    active: row?.active ?? 0,
    waiting: row?.waiting ?? 0,
    latestActivatedAt: row?.latestActivatedAt ?? null,
  }
}

async function decisionCounts(
  transaction: ConcurrencyTransaction,
  workspaceId: string,
  limit: number,
  decision: Pick<WorkflowSlotDecision, 'status' | 'leaseExpiresAt'>,
): Promise<WorkflowSlotDecision> {
  return { ...decision, limit, ...await readCounts(transaction, workspaceId) }
}
