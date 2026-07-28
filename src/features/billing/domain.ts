export const PLAN_KEYS = ['free', 'plus', 'pro', 'max'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export interface PlanDefinition {
  key: PlanKey
  displayName: string
  limitCnyMicros: bigint
  rank: number
}

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  free: { key: 'free', displayName: 'Free', limitCnyMicros: BigInt(10_000_000), rank: 0 },
  plus: { key: 'plus', displayName: 'Plus', limitCnyMicros: BigInt(50_000_000), rank: 1 },
  pro: { key: 'pro', displayName: 'Pro', limitCnyMicros: BigInt(200_000_000), rank: 2 },
  max: { key: 'max', displayName: 'Max', limitCnyMicros: BigInt(2_000_000_000), rank: 3 },
}

const ROLLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000

export function comparePlans(left: PlanKey, right: PlanKey): number {
  return PLAN_DEFINITIONS[left].rank - PLAN_DEFINITIONS[right].rank
}

export function nextRollingPeriod(startsAt: Date): {
  startsAt: Date
  endsAt: Date
} {
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + ROLLING_PERIOD_MS),
  }
}

export type RedemptionTransition =
  | {
      kind: 'upgrade' | 'activate'
      plan: PlanKey
      startsAt: Date
      entitlementExpiresAt: Date
    }
  | { kind: 'extend'; plan: PlanKey; entitlementExpiresAt: Date }
  | { kind: 'reject-lower-tier' }

export function resolveRedemptionTransition(input: {
  currentPlan: PlanKey
  currentEndsAt: Date
  redeemedPlan: PlanKey
  now: Date
}): RedemptionTransition {
  const active = input.currentEndsAt.getTime() > input.now.getTime()
  const comparison = comparePlans(input.redeemedPlan, input.currentPlan)
  if (active && comparison < 0) return { kind: 'reject-lower-tier' }
  if (active && comparison === 0) {
    return {
      kind: 'extend',
      plan: input.redeemedPlan,
      entitlementExpiresAt: new Date(input.currentEndsAt.getTime() + ROLLING_PERIOD_MS),
    }
  }
  const period = nextRollingPeriod(input.now)
  return {
    kind: active ? 'upgrade' : 'activate',
    plan: input.redeemedPlan,
    startsAt: period.startsAt,
    entitlementExpiresAt: period.endsAt,
  }
}
