import { describe, expect, it } from 'vitest'
import { resolveHydratedThemeMode } from './use-theme-mode'

describe('resolveHydratedThemeMode', () => {
  it('uses the same system snapshot for SSR and the hydration frame', () => {
    expect(resolveHydratedThemeMode('dark', false)).toBe('system')
    expect(resolveHydratedThemeMode('light', false)).toBe('system')
  })

  it('exposes the stored mode after hydration', () => {
    expect(resolveHydratedThemeMode('dark', true)).toBe('dark')
    expect(resolveHydratedThemeMode('light', true)).toBe('light')
    expect(resolveHydratedThemeMode(undefined, true)).toBe('system')
  })
})
