import { describe, expect, it } from 'vitest'
import { QuotaExhaustedError, toBillingProjection } from './contracts'

describe('billing public contracts', () => {
  it('projects usage without exposing internal money values', () => {
    const projection = toBillingProjection({
      planKey: 'plus',
      startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2026-07-31T00:00:00.000Z'),
      usedCnyMicros: BigInt(25),
      reservedCnyMicros: BigInt(5),
      limitCnyMicros: BigInt(100),
      invocationCount: 7,
    })
    expect(projection).toEqual({
      planKey: 'plus',
      cycle: {
        startsAt: '2026-07-01T00:00:00.000Z',
        endsAt: '2026-07-31T00:00:00.000Z',
      },
      usage: { percent: 30, remainingPercent: 70, invocationCount: 7 },
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      providerCalls: { stepfun: 0, mimo: 0, gemini: 0 },
      lastInvocationAt: null,
      canRedeem: true,
    })
    expect(JSON.stringify(projection)).not.toMatch(/Cny|micros|limit/i)
  })

  it('exposes a stable quota exhausted error', () => {
    const error = new QuotaExhaustedError('2026-08-01T00:00:00.000Z')
    expect(error).toMatchObject({
      name: 'QuotaExhaustedError',
      code: 'quota_exhausted',
      resetAt: '2026-08-01T00:00:00.000Z',
      billingUrl: '/products/billing',
    })
  })
})
