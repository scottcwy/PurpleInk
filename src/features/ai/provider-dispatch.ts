import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, eq, gt, gte, max, min, ne, sql, sum } from 'drizzle-orm'
import { currentUserId, currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import {
  providerDispatchCooldowns,
  providerDispatches,
  providerPoolStates,
} from '@/lib/db/schema'
import {
  ProviderRequestError,
  type ProviderFailureKind,
  type ProviderFunding,
} from './provider-request-error'
import {
  byokProviderLimits,
  providerLimits,
  type ProviderLimits,
} from './provider-pool-policy'
import {
  ensureProviderPoolState,
  recordProviderGrant,
  recordProviderOutcome,
} from './provider-pool-control'
import {
  ProviderQueueDeferral,
  type ProviderDispatchWaitReason,
} from './provider-queue-deferral'
import { hasWaitingProviderPeer } from './provider-fairness'
import {
  nextProviderWindow,
  PROVIDER_RATE_WINDOW_MS,
} from './provider-dispatch-window'
import { providerPoolMode } from './concurrency-rollout'
import { databaseNow } from './workspace-concurrency-context'
import { deferProviderScope } from './provider-dispatch-cooldown'
import { activateProviderTicket } from './provider-dispatch-ticket'
import { providerScopeKey } from './provider-dispatch-scope'

export { deferProviderScope } from './provider-dispatch-cooldown'
export { providerScopeKey } from './provider-dispatch-scope'

const DEFAULT_LEASE_MS = 5 * 60_000
const MAX_INLINE_WAIT_MS = 2_000

export interface ProviderDispatchInput {
  providerId: string
  poolId?: string
  providerLabel: string
  funding: ProviderFunding
  apiKey: string
  attemptId?: string
  tokenEstimate?: number
  limits?: ProviderLimits
  database?: Db
}

export interface ProviderDispatchLease {
  id: string
  scopeKey: string
  shadowWaitReason?: ProviderDispatchWaitReason
  release(outcome?: 'success' | ProviderFailureKind): Promise<void>
  defer(retryAt?: Date): Promise<void>
}

export async function withProviderDispatch<T>(
  input: ProviderDispatchInput,
  invoke: () => Promise<T>
): Promise<T> {
  const lease = await reserveProviderDispatch(input)
  let outcome: 'success' | ProviderFailureKind = 'success'
  try {
    return await invoke()
  } catch (error) {
    outcome = error instanceof ProviderRequestError ? error.kind : 'unknown'
    if (error instanceof ProviderRequestError && error.kind === 'rate_limit') {
      await lease.defer(error.retryAt ? new Date(error.retryAt) : undefined)
      outcome = 'rate_limit'
    }
    throw error
  } finally {
    await lease.release(outcome)
  }
}

export async function reserveProviderDispatch(
  input: ProviderDispatchInput
): Promise<ProviderDispatchLease> {
  const database = input.database ?? await getDb()
  const workspaceId = currentWorkspaceId()
  const scopeKey = providerScopeKey({
    providerId: input.providerId,
    poolId: input.poolId,
    funding: input.funding,
    workspaceId,
    apiKey: input.apiKey,
  })
  const limits = dispatchLimits(input)
  const id = randomUUID()
  const mode = providerPoolMode()
  let shadowWaitReason: ProviderDispatchWaitReason | undefined
  let notBefore: Date | undefined
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`
    )
    const now = await databaseNow(transaction)
    const poolState = await ensureProviderPoolState(transaction, {
      scopeKey,
      provider: input.providerId,
      limits,
    })
    const actorUserId = safeActorUserId(currentUserId())
    if (
      actorUserId
      && poolState.lastActorUserId === actorUserId
      && await hasWaitingProviderPeer(transaction, scopeKey, actorUserId)
    ) {
      if (mode === 'enforce') {
        throw queueDeferral(
          input,
          scopeKey,
          new Date(now.getTime() + 100 + Math.round(Math.random() * 100)),
          'fairness',
        )
      }
      shadowWaitReason = 'fairness'
    }
    const [cooldown] = await transaction
      .select({ blockedUntil: providerDispatchCooldowns.blockedUntil })
      .from(providerDispatchCooldowns)
      .where(eq(providerDispatchCooldowns.scopeKey, scopeKey))
      .limit(1)
    if (cooldown && cooldown.blockedUntil.getTime() > now.getTime()) {
      if (mode === 'enforce') {
        throw queueDeferral(input, scopeKey, cooldown.blockedUntil, 'cooldown')
      }
      shadowWaitReason ??= 'cooldown'
    }
    await transaction
      .update(providerDispatches)
      .set({ status: 'cancelled', releasedAt: sql`now()` })
      .where(and(
        eq(providerDispatches.scopeKey, scopeKey),
        sql`${providerDispatches.status} in ('scheduled', 'in_flight')`,
        sql`${providerDispatches.leaseExpiresAt} <= now()`,
      ))
    const [usage] = await transaction
      .select({
        rpm: sql<number>`count(*)::int`,
        oldest: min(providerDispatches.notBefore),
        newestStarted: max(providerDispatches.startedAt),
        tokens: sql<number>`coalesce(${sum(providerDispatches.tokenEstimate)}, 0)::int`,
      })
      .from(providerDispatches)
      .where(and(
        eq(providerDispatches.scopeKey, scopeKey),
        ne(providerDispatches.status, 'cancelled'),
        gte(
          providerDispatches.notBefore,
          sql`now() - make_interval(secs => ${PROVIDER_RATE_WINDOW_MS / 1_000})`,
        ),
      ))
    const [active] = await transaction
      .select({
        count: sql<number>`count(*)::int`,
        nextLease: min(providerDispatches.leaseExpiresAt),
      })
      .from(providerDispatches)
      .where(and(
        eq(providerDispatches.scopeKey, scopeKey),
        eq(providerDispatches.status, 'in_flight'),
        gt(providerDispatches.leaseExpiresAt, sql`now()`),
      ))
    const wait = nextProviderWindow({
      limits: { ...limits, concurrency: poolState.currentConcurrency },
      rpm: usage?.rpm ?? 0,
      tokens: usage?.tokens ?? 0,
      tokenEstimate: input.tokenEstimate ?? 0,
      oldest: usage?.oldest ?? null,
      newest: null,
      active: active?.count ?? 0,
      nextLease: active?.nextLease ?? null,
      now,
    })
    if (wait) {
      if (mode === 'enforce') {
        throw queueDeferral(input, scopeKey, wait.retryAt, wait.reason)
      }
      shadowWaitReason ??= wait.reason
    }
    const startedFloor = usage?.newestStarted
      ? new Date(usage.newestStarted.getTime() + (limits.minIntervalMs ?? 0))
      : now
    const scheduledAt = new Date(Math.max(
      now.getTime(),
      poolState.nextDispatchAt.getTime(),
      startedFloor.getTime(),
    ))
    const inlineWaitMs = scheduledAt.getTime() - now.getTime()
    if (inlineWaitMs > MAX_INLINE_WAIT_MS && mode === 'enforce') {
      throw queueDeferral(input, scopeKey, scheduledAt, 'pacing')
    }
    notBefore = mode === 'enforce' ? scheduledAt : now
    if (inlineWaitMs > 0) shadowWaitReason ??= 'pacing'
    const nextDispatchAt = new Date(
      notBefore.getTime()
      + (limits.minIntervalMs ?? 0)
      + Math.round(Math.random() * (limits.jitterMs ?? 0)),
    )
    await transaction.insert(providerDispatches).values({
      id,
      scopeKey,
      workspaceId: input.funding === 'byok' ? workspaceId : null,
      attemptId: input.attemptId,
      provider: input.providerId,
      funding: input.funding,
      tokenEstimate: input.tokenEstimate ?? 0,
      status: 'scheduled',
      notBefore,
      waitReason: inlineWaitMs > 0 ? 'pacing' : null,
      actorUserId,
      leaseExpiresAt: sql`${notBefore.toISOString()}::timestamptz + make_interval(secs => ${DEFAULT_LEASE_MS / 1_000})`,
    })
    await transaction
      .update(providerPoolStates)
      .set({ nextDispatchAt, updatedAt: sql`now()` })
      .where(eq(providerPoolStates.scopeKey, scopeKey))
    await recordProviderGrant(
      transaction,
      scopeKey,
      actorUserId,
    )
  })
  if (!notBefore) {
    throw new Error('provider dispatch scheduling did not resolve database time')
  }
  console.info('[provider_ticket_scheduled]', {
    provider: input.providerId,
    attemptId: input.attemptId ?? null,
    ticketId: id,
    notBefore: notBefore.toISOString(),
    waitReason: shadowWaitReason ?? null,
  })
  await activateProviderTicket(database, {
    id,
    input,
    scopeKey,
  })
  let released = false
  let deferred = false
  return {
    id,
    scopeKey,
    ...(shadowWaitReason ? { shadowWaitReason } : {}),
    release: async (outcome = deferred ? 'rate_limit' : 'success') => {
      if (released) return
      released = true
      await database
        .update(providerDispatches)
        .set({ status: 'released', releasedAt: sql`now()` })
        .where(and(
          eq(providerDispatches.id, id),
          eq(providerDispatches.scopeKey, scopeKey),
          eq(providerDispatches.status, 'in_flight'),
        ))
      await recordProviderOutcome({
        database,
        scopeKey,
        provider: input.providerId,
        limits,
        outcome,
      })
      console.info('[provider_ticket_released]', {
        provider: input.providerId,
        attemptId: input.attemptId ?? null,
        ticketId: id,
        outcome,
      })
    },
    defer: async (retryAt) => {
      deferred = true
      await deferProviderScope(input, retryAt)
    },
  }
}

function dispatchLimits(input: ProviderDispatchInput): ProviderLimits {
  if (input.limits) return input.limits
  return input.funding === 'managed'
    ? providerLimits(input.poolId ?? input.providerId)
    : byokProviderLimits()
}

function queueDeferral(
  input: ProviderDispatchInput,
  scopeKey: string,
  retryAt: Date,
  waitReason: ProviderDispatchWaitReason,
): ProviderQueueDeferral {
  return new ProviderQueueDeferral({
    providerId: input.providerId,
    providerLabel: input.providerLabel,
    retryAt,
    scopeKey,
    waitReason,
  })
}

function safeActorUserId(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value)
    ? value
    : null
}
