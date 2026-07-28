import { describe, expect, it } from 'vitest'
import {
  SKIP_REASON_MAX_LENGTH,
  SKIP_REASON_MIN_LENGTH,
} from '@/features/director/skip-policy'
import { isValidSkipReason } from './skip-node-dialog'

describe('isValidSkipReason', () => {
  it('accepts a trimmed reason within the 1-200 contract', () => {
    expect(isValidSkipReason('素材缺失，先用占位继续')).toBe(true)
    expect(isValidSkipReason('x'.repeat(SKIP_REASON_MAX_LENGTH))).toBe(true)
    expect(isValidSkipReason(` ${'x'.repeat(SKIP_REASON_MIN_LENGTH)} `)).toBe(
      true
    )
  })

  it('rejects blank or whitespace-only reasons', () => {
    expect(isValidSkipReason('')).toBe(false)
    expect(isValidSkipReason('   ')).toBe(false)
  })

  it('rejects reasons longer than the server contract after trim', () => {
    expect(isValidSkipReason('x'.repeat(SKIP_REASON_MAX_LENGTH + 1))).toBe(false)
    // 首尾空白不计入长度：trim 后恰在上限内应放行。
    expect(isValidSkipReason(` ${'x'.repeat(SKIP_REASON_MAX_LENGTH)} `)).toBe(
      true
    )
  })
})
