import 'server-only'
import { eq, sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import { providerPoolStates } from '@/lib/db/schema'
import type { ProviderFailureKind } from './provider-request-error'
import type { ProviderLimits } from './provider-pool-policy'

const CLEAN_WINDOW_MS = 5 * 60_000
const MIN_ADJUSTMENT_SAMPLES = 20

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]

export async function ensureProviderPoolState(
  transaction: Transaction,
  input: {
    scopeKey: string
    provider: string
    limits: ProviderLimits
  },
): Promise<{
  currentConcurrency: number
  maxConcurrency: number
  failureCount: number
  lastAdjustedAt: Date
  lastActorUserId: string | null
}> {
  const maxConcurrency = input.limits.maxConcurrency ?? input.limits.concurrency
  await transaction
    .insert(providerPoolStates)
    .values({
      scopeKey: input.scopeKey,
      provider: input.provider,
      currentConcurrency: input.limits.concurrency,
      maxConcurrency,
    })
    .onConflictDoNothing()
  const [state] = await transaction
    .select({
      currentConcurrency: providerPoolStates.currentConcurrency,
      maxConcurrency: providerPoolStates.maxConcurrency,
      failureCount: providerPoolStates.failureCount,
      lastAdjustedAt: providerPoolStates.lastAdjustedAt,
      lastActorUserId: providerPoolStates.lastActorUserId,
    })
    .from(providerPoolStates)
    .where(eq(providerPoolStates.scopeKey, input.scopeKey))
    .limit(1)
    .for('update')
  if (!state) throw new Error(`Provider pool state missing: ${input.provider}`)
  return state
}

export async function recordProviderRateLimit(input: {
  database: Db
  scopeKey: string
  provider: string
  limits: ProviderLimits
}): Promise<void> {
  await input.database.transaction(async (transaction) => {
    await lockScope(transaction, input.scopeKey)
    const state = await ensureProviderPoolState(transaction, input)
    if (
      state.failureCount > 0
      && Date.now() - state.lastAdjustedAt.getTime() < 1_000
    ) return
    await transaction
      .update(providerPoolStates)
      .set({
        currentConcurrency: Math.max(1, Math.floor(state.currentConcurrency * 0.75)),
        cleanSince: sql`now()`,
        completedSinceAdjustment: 0,
        failureCount: sql`${providerPoolStates.failureCount} + 1`,
        lastAdjustedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(providerPoolStates.scopeKey, input.scopeKey))
  })
}

export async function recordProviderOutcome(input: {
  database: Db
  scopeKey: string
  provider: string
  limits: ProviderLimits
  outcome: 'success' | ProviderFailureKind
}): Promise<void> {
  if (input.outcome === 'rate_limit') return
  await input.database.transaction(async (transaction) => {
    await lockScope(transaction, input.scopeKey)
    const state = await ensureProviderPoolState(transaction, input)
    const [counters] = await transaction
      .select({
        cleanSince: providerPoolStates.cleanSince,
        completed: providerPoolStates.completedSinceAdjustment,
        failures: providerPoolStates.failureCount,
      })
      .from(providerPoolStates)
      .where(eq(providerPoolStates.scopeKey, input.scopeKey))
      .limit(1)
      .for('update')
    if (!counters) return
    const failure = isCapacityFailure(input.outcome)
    const completed = counters.completed + (input.outcome === 'success' ? 1 : 0)
    const failures = counters.failures + (failure ? 1 : 0)
    const samples = completed + failures
    const shouldDecrease = samples >= MIN_ADJUSTMENT_SAMPLES
      && failures / samples > 0.02
    const shouldIncrease = input.outcome === 'success'
      && completed >= MIN_ADJUSTMENT_SAMPLES
      && Date.now() - counters.cleanSince.getTime() >= CLEAN_WINDOW_MS
      && state.currentConcurrency < state.maxConcurrency
    await transaction
      .update(providerPoolStates)
      .set({
        currentConcurrency: shouldDecrease
          ? Math.max(1, Math.floor(state.currentConcurrency * 0.75))
          : shouldIncrease
            ? state.currentConcurrency + 1
            : state.currentConcurrency,
        completedSinceAdjustment: shouldDecrease || shouldIncrease ? 0 : completed,
        failureCount: shouldDecrease || shouldIncrease ? 0 : failures,
        cleanSince: shouldDecrease || shouldIncrease ? sql`now()` : counters.cleanSince,
        lastAdjustedAt: shouldDecrease || shouldIncrease
          ? sql`now()`
          : providerPoolStates.lastAdjustedAt,
        updatedAt: sql`now()`,
      })
      .where(eq(providerPoolStates.scopeKey, input.scopeKey))
  })
}

export async function recordProviderGrant(
  transaction: Transaction,
  scopeKey: string,
  actorUserId: string | null,
): Promise<void> {
  await transaction
    .update(providerPoolStates)
    .set({ lastActorUserId: actorUserId, updatedAt: sql`now()` })
    .where(eq(providerPoolStates.scopeKey, scopeKey))
}

async function lockScope(transaction: Transaction, scopeKey: string): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`,
  )
}

function isCapacityFailure(outcome: string): boolean {
  return outcome === 'timeout' || outcome === 'unavailable' || outcome === 'network'
}
