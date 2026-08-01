import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { escapeLikePattern } from './user-admin'
import { parseOptionalFutureDate } from './http-errors'

describe('admin account and billing input contracts', () => {
  it('escapes PostgreSQL ILIKE wildcard characters in literal user searches', () => {
    expect(escapeLikePattern(String.raw`100%_match\mail`))
      .toBe(String.raw`100!%!_match\mail`)
  })

  it('rejects a supplied invalid or expired batch deadline instead of dropping it', () => {
    expect(() => parseOptionalFutureDate('not-a-date', new Date('2026-08-01T00:00:00Z')))
      .toThrow('兑换批次参数不正确')
    expect(() => parseOptionalFutureDate('2026-07-31T23:59:59Z', new Date('2026-08-01T00:00:00Z')))
      .toThrow('兑换批次参数不正确')
    expect(parseOptionalFutureDate(null, new Date('2026-08-01T00:00:00Z'))).toBeNull()
  })
})
