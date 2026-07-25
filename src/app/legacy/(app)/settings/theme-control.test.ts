import { describe, expect, it } from 'vitest'
import { resolveDarkMode } from './theme-control'

describe('resolveDarkMode', () => {
  it('honors explicit light and dark modes', () => {
    expect(resolveDarkMode('light', true)).toBe(false)
    expect(resolveDarkMode('dark', false)).toBe(true)
  })

  it('follows the system only in system mode', () => {
    expect(resolveDarkMode('system', true)).toBe(true)
    expect(resolveDarkMode('system', false)).toBe(false)
  })
})
