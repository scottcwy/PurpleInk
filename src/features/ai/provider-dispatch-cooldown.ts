import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  providerDispatchCooldowns,
  providerPoolStates,
} from '@/lib/db/schema'
import { databaseNow } from './workspace-concurrency-context'
import { providerRateLimitBackoffMs } from './provider-dispatch-window'
import {
  providerLimits,
  byokProviderLimits,
} from './provider-pool-policy'
import type { ProviderDispatchInput } from './provider-dispatch'
import { providerScopeKey } from './provider-dispatch-scope'
import { recordProviderRateLimit } from './provider-pool-control'

export async function deferProviderScope(
  input: ProviderDispatchInput,
  retryAt?: Date,
): Promise<void> {
  const database = input.database ?? await getDb()
  const limits = input.limits ?? (input.funding === 'managed'
    ? providerLimits(input.providerId)
    : byokProviderLimits())
  const scopeKey = providerScopeKey({
    providerId: input.providerId,
    funding: input.funding,
    workspaceId: currentWorkspaceId(),
    apiKey: input.apiKey,
  })
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`,
    )
    const now = await databaseNow(transaction)
    const [state] = await transaction
      .select({ failureCount: providerPoolStates.failureCount })
      .from(providerPoolStates)
      .where(eq(providerPoolStates.scopeKey, scopeKey))
      .limit(1)
    const fallback = new Date(
      now.getTime() + providerRateLimitBackoffMs(state?.failureCount ?? 0),
    )
    const blockedUntil = retryAt && retryAt.getTime() > now.getTime()
      ? retryAt
      : fallback
    await transaction
      .insert(providerDispatchCooldowns)
      .values({ scopeKey, provider: input.providerId, blockedUntil })
      .onConflictDoUpdate({
        target: providerDispatchCooldowns.scopeKey,
        set: {
          blockedUntil: sql`greatest(
            ${providerDispatchCooldowns.blockedUntil},
            ${blockedUntil.toISOString()}::timestamptz
          )`,
          updatedAt: sql`now()`,
        },
      })
  })
  await recordProviderRateLimit({
    database,
    scopeKey,
    provider: input.providerId,
    limits,
  })
}
