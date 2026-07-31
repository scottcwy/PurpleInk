import { describe, expect, it } from 'vitest'
import {
  PLAN_DEFINITIONS,
  comparePlans,
  nextRollingPeriod,
  resolveRedemptionTransition,
  subscriptionConcurrencyLimit,
  usagePeriodPlanSnapshot,
} from './domain'

describe('billing plans', () => {
  it('defines the four plans with CNY micros bigint limits', () => {
    expect(Object.keys(PLAN_DEFINITIONS)).toEqual(['free', 'plus', 'pro', 'max'])
    expect(PLAN_DEFINITIONS.free.limitCnyMicros).toBe(BigInt(10_000_000))
    expect(PLAN_DEFINITIONS.max.limitCnyMicros).toBe(BigInt(2_000_000_000))
    expect(typeof PLAN_DEFINITIONS.pro.limitCnyMicros).toBe('bigint')
  })

  it('orders plans without relying on their display labels', () => {
    expect(comparePlans('free', 'plus')).toBeLessThan(0)
    expect(comparePlans('max', 'pro')).toBeGreaterThan(0)
    expect(comparePlans('pro', 'pro')).toBe(0)
  })

  it('locks one workspace-wide shot concurrency cap per subscription plan', () => {
    expect(subscriptionConcurrencyLimit('free')).toBe(3)
    expect(subscriptionConcurrencyLimit('plus')).toBe(20)
    expect(subscriptionConcurrencyLimit('pro')).toBe(50)
    expect(subscriptionConcurrencyLimit('max')).toBe(100)
  })

  it('freezes the complete plan contract into each usage period', () => {
    expect(usagePeriodPlanSnapshot('pro')).toEqual({
      planKey: 'pro',
      planVersion: PLAN_DEFINITIONS.pro.version,
      concurrencyLimit: 50,
      managedProviders: [
        'stepfun',
        'mimo',
        'gemini',
        'openai',
        'anthropic',
      ],
      limitCnyMicros: BigInt(200_000_000),
    })
  })
})

describe('rolling periods', () => {
  it('creates an exact 30 day period', () => {
    const start = new Date('2026-07-28T12:00:00.000Z')
    expect(nextRollingPeriod(start)).toEqual({
      startsAt: start,
      endsAt: new Date('2026-08-27T12:00:00.000Z'),
    })
  })
})

describe('redemption transitions', () => {
  const now = new Date('2026-07-28T12:00:00.000Z')
  const currentEnd = new Date('2026-08-10T12:00:00.000Z')

  it('extends an unexpired entitlement when redeeming the same tier', () => {
    expect(resolveRedemptionTransition({
      currentPlan: 'plus',
      currentEndsAt: currentEnd,
      redeemedPlan: 'plus',
      now,
    })).toEqual({
      kind: 'extend',
      plan: 'plus',
      entitlementExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
    })
  })

  it('starts a fresh period immediately for a higher tier', () => {
    expect(resolveRedemptionTransition({
      currentPlan: 'plus',
      currentEndsAt: currentEnd,
      redeemedPlan: 'pro',
      now,
    })).toEqual({
      kind: 'upgrade',
      plan: 'pro',
      startsAt: now,
      entitlementExpiresAt: new Date('2026-08-27T12:00:00.000Z'),
    })
  })

  it('rejects a lower tier while the higher entitlement is active', () => {
    expect(resolveRedemptionTransition({
      currentPlan: 'pro',
      currentEndsAt: currentEnd,
      redeemedPlan: 'plus',
      now,
    })).toEqual({ kind: 'reject-lower-tier' })
  })
})
