'use client'

import { useTheme } from 'next-themes'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  isThemeMode,
  type ThemeMode,
} from '@/lib/theme-mode'

export type { ThemeMode } from '@/lib/theme-mode'
export {
  THEME_MODE_ORDER,
  applyTheme,
  isThemeMode,
  nextThemeMode,
  resolveDarkMode,
  themeModeLabel,
} from '@/lib/theme-mode'

const OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

export function ThemeControl() {
  const { theme, setTheme } = useTheme()
  const mode: ThemeMode = isThemeMode(theme) ? theme : 'system'

  return (
    <SegmentedControl
      options={OPTIONS}
      value={mode}
      onChange={(next) => {
        if (!isThemeMode(next)) return
        setTheme(next)
      }}
    />
  )
}
