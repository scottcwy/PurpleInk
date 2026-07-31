import {
  AI_BILLING_MANIFEST,
  type BuiltInProviderId,
} from '@/lib/config/generated/ai-billing-manifest'

export const PLAN_KEYS = ['free', 'plus', 'pro', 'max'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export interface PlanDefinition {
  key: PlanKey
  version: string
  displayName: string
  limitCnyMicros: bigint
  rank: number
  concurrency: number
  managedProviders: readonly BuiltInProviderId[]
}

export interface UsagePeriodPlanSnapshot {
  planKey: PlanKey
  planVersion: string
  concurrencyLimit: number
  managedProviders: BuiltInProviderId[]
  limitCnyMicros: bigint
}

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  free: planDefinition('free'),
  plus: planDefinition('plus'),
  pro: planDefinition('pro'),
  max: planDefinition('max'),
}

/** 同一 workspace 下所有项目与成员共享的活跃分镜上限。 */
export function subscriptionConcurrencyLimit(plan: PlanKey): number {
  return PLAN_DEFINITIONS[plan].concurrency
}

export function planCanUseManagedProvider(
  plan: PlanKey,
  provider: BuiltInProviderId,
): boolean {
  return (PLAN_DEFINITIONS[plan].managedProviders as readonly string[])
    .includes(provider)
}

export function minimumPlanForManagedProvider(
  provider: BuiltInProviderId,
): PlanKey {
  const plan = PLAN_KEYS.find((candidate) =>
    planCanUseManagedProvider(candidate, provider))
  if (!plan) throw new Error(`managed provider has no plan assignment: ${provider}`)
  return plan
}

export function usagePeriodPlanSnapshot(plan: PlanKey): UsagePeriodPlanSnapshot {
  const definition = PLAN_DEFINITIONS[plan]
  return {
    planKey: definition.key,
    planVersion: definition.version,
    concurrencyLimit: definition.concurrency,
    managedProviders: [...definition.managedProviders],
    limitCnyMicros: definition.limitCnyMicros,
  }
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

function planDefinition(key: PlanKey): PlanDefinition {
  const plan = AI_BILLING_MANIFEST.plans[key]
  return {
    key,
    version: AI_BILLING_MANIFEST.catalogVersions.plans,
    displayName: plan.displayName,
    limitCnyMicros: BigInt(plan.limitCnyMicros),
    rank: plan.rank,
    concurrency: plan.concurrency,
    managedProviders: plan.managedProviders,
  }
}
