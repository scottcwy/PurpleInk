import { describe, expect, it } from 'vitest'
import { applyBillingRatio, divideBillingRoundUp } from './billing-math'

describe('billing integer arithmetic', () => {
  it('applies versioned rational multipliers without floating point', () => {
    expect(applyBillingRatio(BigInt(5), BigInt(3), BigInt(2))).toBe(BigInt(8))
    expect(applyBillingRatio(BigInt(10), BigInt(1), BigInt(1))).toBe(BigInt(10))
  })

  it('rounds positive micros upward and rejects invalid ratios', () => {
    expect(divideBillingRoundUp(BigInt(1), BigInt(3))).toBe(BigInt(1))
    expect(() => applyBillingRatio(BigInt(-1), BigInt(1), BigInt(1)))
      .toThrow('must not be negative')
    expect(() => applyBillingRatio(BigInt(1), BigInt(1), BigInt(0)))
      .toThrow('denominator must be positive')
  })
})
