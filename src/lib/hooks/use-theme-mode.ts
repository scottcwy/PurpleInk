'use client'

import { useTheme } from 'next-themes'
import { isThemeMode, type ThemeMode } from '@/lib/theme-mode'
import { useHydrated } from './use-hydrated'

export function resolveHydratedThemeMode(
  theme: string | undefined,
  hydrated: boolean,
): ThemeMode {
  return hydrated && isThemeMode(theme) ? theme : 'system'
}

/**
 * next-themes 的值来自浏览器存储；hydration 首帧必须与 SSR 共用 system 快照。
 */
export function useThemeMode() {
  const hydrated = useHydrated()
  const { theme, resolvedTheme, setTheme } = useTheme()

  return {
    hydrated,
    mode: resolveHydratedThemeMode(theme, hydrated),
    resolvedTheme: hydrated ? resolvedTheme : undefined,
    setTheme,
  }
}
