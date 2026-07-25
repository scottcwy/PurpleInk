export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_MODE_ORDER = ['light', 'dark', 'system'] as const

export function nextThemeMode(current: string | null | undefined): ThemeMode {
  const mode = isThemeMode(current) ? current : 'system'
  const index = THEME_MODE_ORDER.indexOf(mode)
  return THEME_MODE_ORDER[(index + 1) % THEME_MODE_ORDER.length]!
}

export function themeModeLabel(mode: ThemeMode): string {
  if (mode === 'light') return '浅色'
  if (mode === 'dark') return '深色'
  return '跟随系统'
}

export function applyTheme(mode: ThemeMode, systemDark: boolean): void {
  document.documentElement.classList.toggle('dark', resolveDarkMode(mode, systemDark))
}

export function resolveDarkMode(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark)
}

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}
