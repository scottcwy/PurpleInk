import { describe, expect, it } from 'vitest'
import {
  PUBLIC_PLAN_CARDS,
  clampUsagePercent,
  formatBillingPeriod,
  getQuotaUpgradeDirection,
} from './billing-display'

describe('billing public display', () => {
  it('exposes the approved plans without internal cost-pool values', () => {
    expect(PUBLIC_PLAN_CARDS.map(({ key, price, quotaLabel }) => ({
      key,
      price,
      quotaLabel,
    }))).toEqual([
      { key: 'free', price: 0, quotaLabel: '基础额度' },
      { key: 'plus', price: 29, quotaLabel: '5x 额度' },
      { key: 'pro', price: 99, quotaLabel: '20x 额度' },
      { key: 'max', price: 599, quotaLabel: '200x 额度' },
    ])
    expect(JSON.stringify(PUBLIC_PLAN_CARDS)).not.toContain('limitCnyMicros')
    expect(PUBLIC_PLAN_CARDS.at(-1)?.features).toEqual(['200x 平台 AI 额度'])
  })

  it('clamps usage for progress projections', () => {
    expect(clampUsagePercent(-1)).toBe(0)
    expect(clampUsagePercent(42.6)).toBe(43)
    expect(clampUsagePercent(120)).toBe(100)
  })

  it('formats rolling periods as a readable date range', () => {
    expect(formatBillingPeriod({
      startsAt: '2026-07-28T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
    })).toContain('2026')
    expect(formatBillingPeriod({
      startsAt: '2026-07-28T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
    })).toContain('8')
  })

  it('directs exhausted plans to the next tier and Max to the next cycle', () => {
    expect(getQuotaUpgradeDirection('free')).toEqual({
      nextPlan: 'plus',
      actionLabel: '升级至 Plus',
    })
    expect(getQuotaUpgradeDirection('plus')?.nextPlan).toBe('pro')
    expect(getQuotaUpgradeDirection('pro')?.nextPlan).toBe('max')
    expect(getQuotaUpgradeDirection('max')).toBeNull()
  })
})
