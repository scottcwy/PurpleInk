import { describe, expect, it } from 'vitest'
import {
  nextThemeMode,
  resolveDarkMode,
  themeModeLabel,
} from './theme-mode'

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

describe('nextThemeMode', () => {
  it('cycles light → dark → system → light', () => {
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
  })

  it('falls back to system when current is unknown', () => {
    expect(nextThemeMode(undefined)).toBe('light')
    expect(nextThemeMode('nope')).toBe('light')
  })
})

describe('themeModeLabel', () => {
  it('returns Chinese labels', () => {
    expect(themeModeLabel('light')).toBe('浅色')
    expect(themeModeLabel('dark')).toBe('深色')
    expect(themeModeLabel('system')).toBe('跟随系统')
  })
})
