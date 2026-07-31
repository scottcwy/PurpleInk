import type { PlanKey } from './domain'
import {
  BUILT_IN_PROVIDER_IDS,
  type BuiltInProviderId,
} from '@/lib/config/generated/ai-public-catalog'

export type ProviderCallCounts = Record<BuiltInProviderId, number>

export interface BillingProjection {
  planKey: PlanKey
  cycle: { startsAt: string; endsAt: string }
  usage: {
    percent: number
    invocationCount: number
    remainingPercent: number
  }
  tokenUsage: { inputTokens: number; outputTokens: number }
  providerCalls: ProviderCallCounts
  lastInvocationAt: string | null
  canRedeem: boolean
}

export class QuotaExhaustedError extends Error {
  readonly code = 'quota_exhausted' as const
  readonly billingUrl = '/products/billing' as const

  constructor(readonly resetAt: string) {
    super('Managed AI quota is exhausted')
    this.name = 'QuotaExhaustedError'
  }
}

export class BillingIdempotencyConflictError extends Error {
  readonly code = 'idempotency_conflict' as const

  constructor() {
    super('Idempotency key was already used for a different request')
    this.name = 'BillingIdempotencyConflictError'
  }
}

export class ProviderInvocationAlreadyStartedError extends Error {
  readonly code = 'provider_invocation_already_started' as const

  constructor() {
    super('Provider invocation was already started')
    this.name = 'ProviderInvocationAlreadyStartedError'
  }
}

export function toBillingProjection(input: {
  planKey: PlanKey
  startsAt: Date
  endsAt: Date
  usedCnyMicros: bigint
  reservedCnyMicros: bigint
  limitCnyMicros: bigint
  invocationCount: number
  inputTokens?: number
  outputTokens?: number
  providerCalls?: ProviderCallCounts
  lastInvocationAt?: Date | null
  canRedeem?: boolean
}): BillingProjection {
  const consumed = input.usedCnyMicros + input.reservedCnyMicros
  const percent = input.limitCnyMicros === BigInt(0)
    ? 100
    : Math.min(100, Math.round(Number(consumed * BigInt(100)) / Number(input.limitCnyMicros)))
  return {
    planKey: input.planKey,
    cycle: {
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
    },
    usage: {
      percent,
      remainingPercent: 100 - percent,
      invocationCount: input.invocationCount,
    },
    tokenUsage: {
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
    },
    providerCalls: input.providerCalls ?? createProviderCallCounts(),
    lastInvocationAt: input.lastInvocationAt?.toISOString() ?? null,
    canRedeem: input.canRedeem ?? true,
  }
}

export function createProviderCallCounts(): ProviderCallCounts {
  return Object.fromEntries(
    BUILT_IN_PROVIDER_IDS.map((provider) => [provider, 0]),
  ) as ProviderCallCounts
}

export function isBuiltInProviderId(value: string): value is BuiltInProviderId {
  return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(value)
}
