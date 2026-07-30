import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, gt, gte, max, min, sql, sum } from 'drizzle-orm'
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
  recordProviderRateLimit,
} from './provider-pool-control'
import {
  ProviderDispatchWaitError,
  type ProviderDispatchWaitReason,
} from './provider-dispatch-wait-error'
import { hasWaitingProviderPeer } from './provider-fairness'
import {
  nextProviderWindow,
  PROVIDER_RATE_WINDOW_MS,
  providerRateLimitBackoffMs,
} from './provider-dispatch-window'
import { providerPoolMode } from './concurrency-rollout'
import { databaseNow } from './workspace-concurrency-context'

const DEFAULT_LEASE_MS = 5 * 60_000

export interface ProviderDispatchInput {
  providerId: string
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
    funding: input.funding,
    workspaceId,
    apiKey: input.apiKey,
  })
  const limits = dispatchLimits(input)
  const id = randomUUID()
  const mode = providerPoolMode()
  let shadowWaitReason: ProviderDispatchWaitReason | undefined
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
        throw dispatchWaitError(
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
        throw dispatchWaitError(input, scopeKey, cooldown.blockedUntil, 'cooldown')
      }
      shadowWaitReason ??= 'cooldown'
    }
    await transaction
      .update(providerDispatches)
      .set({ status: 'released', releasedAt: sql`now()` })
      .where(and(
        eq(providerDispatches.scopeKey, scopeKey),
        eq(providerDispatches.status, 'reserved'),
        sql`${providerDispatches.leaseExpiresAt} <= now()`,
      ))
    const [usage] = await transaction
      .select({
        rpm: sql<number>`count(*)::int`,
        oldest: min(providerDispatches.reservedAt),
        newest: max(providerDispatches.reservedAt),
        tokens: sql<number>`coalesce(${sum(providerDispatches.tokenEstimate)}, 0)::int`,
      })
      .from(providerDispatches)
      .where(and(
        eq(providerDispatches.scopeKey, scopeKey),
        gte(
          providerDispatches.reservedAt,
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
        eq(providerDispatches.status, 'reserved'),
        gt(providerDispatches.leaseExpiresAt, sql`now()`),
      ))
    const wait = nextProviderWindow({
      limits: { ...limits, concurrency: poolState.currentConcurrency },
      rpm: usage?.rpm ?? 0,
      tokens: usage?.tokens ?? 0,
      tokenEstimate: input.tokenEstimate ?? 0,
      oldest: usage?.oldest ?? null,
      newest: usage?.newest ?? null,
      active: active?.count ?? 0,
      nextLease: active?.nextLease ?? null,
      now,
    })
    if (wait) {
      if (mode === 'enforce') {
        throw dispatchWaitError(input, scopeKey, wait.retryAt, wait.reason)
      }
      shadowWaitReason ??= wait.reason
    }
    await transaction.insert(providerDispatches).values({
      id,
      scopeKey,
      workspaceId: input.funding === 'byok' ? workspaceId : null,
      attemptId: input.attemptId,
      provider: input.providerId,
      funding: input.funding,
      tokenEstimate: input.tokenEstimate ?? 0,
      leaseExpiresAt: sql`now() + make_interval(secs => ${DEFAULT_LEASE_MS / 1_000})`,
    })
    await recordProviderGrant(
      transaction,
      scopeKey,
      actorUserId,
    )
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
        ))
      await recordProviderOutcome({
        database,
        scopeKey,
        provider: input.providerId,
        limits,
        outcome,
      })
    },
    defer: async (retryAt) => {
      deferred = true
      await deferProviderScope(input, retryAt)
    },
  }
}

export async function deferProviderScope(
  input: ProviderDispatchInput,
  retryAt?: Date
): Promise<void> {
  const database = input.database ?? await getDb()
  const limits = dispatchLimits(input)
  const scopeKey = providerScopeKey({
    providerId: input.providerId,
    funding: input.funding,
    workspaceId: currentWorkspaceId(),
    apiKey: input.apiKey,
  })
  const [state] = await database
    .select({ failureCount: providerPoolStates.failureCount })
    .from(providerPoolStates)
    .where(eq(providerPoolStates.scopeKey, scopeKey))
    .limit(1)
  const fallback = new Date(
    Date.now() + providerRateLimitBackoffMs(state?.failureCount ?? 0),
  )
  const blockedUntil = retryAt && retryAt.getTime() > Date.now() ? retryAt : fallback
  await database
    .insert(providerDispatchCooldowns)
    .values({ scopeKey, provider: input.providerId, blockedUntil })
    .onConflictDoUpdate({
      target: providerDispatchCooldowns.scopeKey,
      set: {
        blockedUntil: sql`greatest(
          ${providerDispatchCooldowns.blockedUntil},
          ${blockedUntil.toISOString()}::timestamptz
        )`,
        updatedAt: new Date(),
      },
    })
  await recordProviderRateLimit({
    database,
    scopeKey,
    provider: input.providerId,
    limits,
  })
}

export function providerScopeKey(input: {
  providerId: string
  funding: ProviderFunding
  workspaceId: string
  apiKey: string
}): string {
  const credential = createHash('sha256').update(input.apiKey).digest('hex')
  const identity = input.funding === 'managed'
    ? `managed:${input.providerId}`
    : `byok:${input.workspaceId}:${input.providerId}:${credential}`
  return createHash('sha256').update(identity).digest('hex')
}

function dispatchLimits(input: ProviderDispatchInput): ProviderLimits {
  if (input.limits) return input.limits
  return input.funding === 'managed'
    ? providerLimits(input.providerId)
    : byokProviderLimits()
}

function dispatchWaitError(
  input: ProviderDispatchInput,
  scopeKey: string,
  retryAt: Date,
  waitReason: ProviderDispatchWaitReason,
): ProviderDispatchWaitError {
  return new ProviderDispatchWaitError({
    providerId: input.providerId,
    providerLabel: input.providerLabel,
    funding: input.funding,
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
