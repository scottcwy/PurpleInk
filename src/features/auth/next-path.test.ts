import { describe, expect, it } from 'vitest'
import { DEFAULT_POST_LOGIN_PATH, safeNextPath } from './next-path'

describe('post-login redirect whitelist', () => {
  it('keeps in-site absolute paths', () => {
    expect(safeNextPath('/products/canvas/abc?tab=graph')).toBe('/products/canvas/abc?tab=graph')
    expect(safeNextPath('/products/dashboard')).toBe('/products/dashboard')
  })

  it('falls back for every open-redirect shape', () => {
    for (const hostile of [
      '//evil.com',
      '///evil.com',
      'http://evil.com',
      'https://evil.com',
      '/\\evil.com',
      '\\/evil.com',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>',
      'products/dashboard',
      '',
      '   ',
    ]) {
      expect(safeNextPath(hostile)).toBe(DEFAULT_POST_LOGIN_PATH)
    }
  })

  it('falls back when the value is missing', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeNextPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH)
  })

  it('rejects control characters used to smuggle a second header or scheme', () => {
    expect(safeNextPath('/products\n/dashboard')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeNextPath('/products\t/dashboard')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeNextPath('/products\u0000')).toBe(DEFAULT_POST_LOGIN_PATH)
  })

  it('does not send the user back to the auth pages themselves', () => {
    expect(safeNextPath('/login')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeNextPath('/signup?next=/login')).toBe(DEFAULT_POST_LOGIN_PATH)
    expect(safeNextPath('/password/reset')).toBe(DEFAULT_POST_LOGIN_PATH)
  })

  it('caps absurdly long values', () => {
    expect(safeNextPath(`/products/${'a'.repeat(4000)}`)).toBe(DEFAULT_POST_LOGIN_PATH)
  })
})
