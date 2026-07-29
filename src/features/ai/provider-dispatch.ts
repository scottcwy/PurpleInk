import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, gt, gte, min, sql, sum } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { providerDispatchCooldowns, providerDispatches } from '@/lib/db/schema'
import {
  ProviderRequestError,
  type ProviderFunding,
} from './provider-request-error'

const RATE_WINDOW_MS = 60_000
const DEFAULT_LEASE_MS = 5 * 60_000

export interface ProviderLimits {
  concurrency: number
  rpm: number
  tpm?: number
}

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
  release(): Promise<void>
  defer(retryAt?: Date): Promise<void>
}

export async function withProviderDispatch<T>(
  input: ProviderDispatchInput,
  invoke: () => Promise<T>
): Promise<T> {
  const lease = await reserveProviderDispatch(input)
  try {
    return await invoke()
  } catch (error) {
    if (error instanceof ProviderRequestError && error.kind === 'rate_limit') {
      await lease.defer(error.retryAt ? new Date(error.retryAt) : undefined)
    }
    throw error
  } finally {
    await lease.release()
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
  const limits = input.limits ?? providerLimits(input.providerId)
  const id = randomUUID()
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`
    )
    const [cooldown] = await transaction
      .select({ blockedUntil: providerDispatchCooldowns.blockedUntil })
      .from(providerDispatchCooldowns)
      .where(eq(providerDispatchCooldowns.scopeKey, scopeKey))
      .limit(1)
    if (cooldown && cooldown.blockedUntil.getTime() > Date.now()) {
      throw rateLimitError(input, cooldown.blockedUntil)
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
        tokens: sql<number>`coalesce(${sum(providerDispatches.tokenEstimate)}, 0)::int`,
      })
      .from(providerDispatches)
      .where(and(
        eq(providerDispatches.scopeKey, scopeKey),
        gte(
          providerDispatches.reservedAt,
          sql`now() - make_interval(secs => ${RATE_WINDOW_MS / 1_000})`,
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
    const nextAt = nextAvailableAt({
      limits,
      rpm: usage?.rpm ?? 0,
      tokens: usage?.tokens ?? 0,
      tokenEstimate: input.tokenEstimate ?? 0,
      oldest: usage?.oldest ?? null,
      active: active?.count ?? 0,
      nextLease: active?.nextLease ?? null,
    })
    if (nextAt) {
      throw new ProviderRequestError({
        providerId: input.providerId,
        providerLabel: input.providerLabel,
        operation: '调用',
        funding: input.funding,
        httpStatus: 429,
        retryAt: nextAt,
        kind: 'rate_limit',
      })
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
  })
  let released = false
  return {
    id,
    scopeKey,
    release: async () => {
      if (released) return
      released = true
      await database
        .update(providerDispatches)
        .set({ status: 'released', releasedAt: sql`now()` })
        .where(and(
          eq(providerDispatches.id, id),
          eq(providerDispatches.scopeKey, scopeKey),
        ))
    },
    defer: async (retryAt) => {
      await deferProviderScope(input, retryAt)
    },
  }
}

export async function deferProviderScope(
  input: ProviderDispatchInput,
  retryAt?: Date
): Promise<void> {
  const database = input.database ?? await getDb()
  const limits = input.limits ?? providerLimits(input.providerId)
  const scopeKey = providerScopeKey({
    providerId: input.providerId,
    funding: input.funding,
    workspaceId: currentWorkspaceId(),
    apiKey: input.apiKey,
  })
  const fallback = new Date(Date.now() + RATE_WINDOW_MS / limits.rpm)
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
}

export function providerScopeKey(input: {
  providerId: string
  funding: ProviderFunding
  workspaceId: string
  apiKey: string
}): string {
  const credential = createHash('sha256').update(input.apiKey).digest('hex')
  const identity = input.funding === 'managed'
    ? `managed:${input.providerId}:${credential}`
    : `byok:${input.workspaceId}:${input.providerId}:${credential}`
  return createHash('sha256').update(identity).digest('hex')
}

export function providerLimits(providerId: string): ProviderLimits {
  const prefix = providerId.replaceAll('-', '_').toUpperCase()
  const defaults = providerId === 'stepfun'
    ? { concurrency: 5, rpm: 5 }
    : { concurrency: 4, rpm: 60 }
  return {
    concurrency: positiveInteger(process.env[`${prefix}_CONCURRENCY_LIMIT`])
      ?? defaults.concurrency,
    rpm: positiveInteger(process.env[`${prefix}_RPM_LIMIT`]) ?? defaults.rpm,
    ...(positiveInteger(process.env[`${prefix}_TPM_LIMIT`]) !== undefined
      ? { tpm: positiveInteger(process.env[`${prefix}_TPM_LIMIT`]) }
      : {}),
  }
}

function nextAvailableAt(input: {
  limits: ProviderLimits
  rpm: number
  tokens: number
  tokenEstimate: number
  oldest: Date | null
  active: number
  nextLease: Date | null
}): Date | undefined {
  const candidates: Date[] = []
  if (input.rpm >= input.limits.rpm && input.oldest) {
    candidates.push(new Date(input.oldest.getTime() + RATE_WINDOW_MS))
  }
  if (
    input.limits.tpm !== undefined
    && input.tokens + input.tokenEstimate > input.limits.tpm
    && input.oldest
  ) {
    candidates.push(new Date(input.oldest.getTime() + RATE_WINDOW_MS))
  }
  if (input.active >= input.limits.concurrency && input.nextLease) {
    candidates.push(input.nextLease)
  }
  if (candidates.length === 0) return undefined
  const latest = Math.max(...candidates.map((candidate) => candidate.getTime()))
  return new Date(latest + Math.round(Math.random() * 750))
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function rateLimitError(
  input: ProviderDispatchInput,
  retryAt: Date
): ProviderRequestError {
  return new ProviderRequestError({
    providerId: input.providerId,
    providerLabel: input.providerLabel,
    operation: '调用',
    funding: input.funding,
    httpStatus: 429,
    retryAt,
    kind: 'rate_limit',
  })
}
