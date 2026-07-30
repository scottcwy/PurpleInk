import { describe, expect, it } from 'vitest'
import { billingInvocationNo } from './invocation-number'

describe('billingInvocationNo', () => {
  it('keeps billing responsibilities in non-overlapping partitions', () => {
    expect(billingInvocationNo('director', 1)).toBe(1)
    expect(billingInvocationNo('narration', 1)).toBe(10_000)
    expect(billingInvocationNo('subtitle-asr', 1)).toBe(20_000)
    expect(billingInvocationNo('vision-qa', 1)).toBe(30_000)
    expect(billingInvocationNo('source-asr', 1)).toBe(40_000)
  })

  it('rejects invalid and overflowing indexes before reservation', () => {
    expect(() => billingInvocationNo('director', 0)).toThrow('必须从 1 开始')
    expect(() => billingInvocationNo('director', 10_000)).toThrow('超出')
  })
})
