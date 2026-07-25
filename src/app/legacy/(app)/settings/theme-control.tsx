'use client'

import { useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'

export type ThemeMode = 'light' | 'dark' | 'system'

const OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
]

export function ThemeControl() {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    const stored = localStorage.getItem('theme-mode')
    const initial = isThemeMode(stored) ? stored : 'system'
    applyTheme(initial, window.matchMedia('(prefers-color-scheme: dark)').matches)
    queueMicrotask(() => setMode(initial))
  }, [])

  function change(next: string) {
    if (!isThemeMode(next)) return
    setMode(next)
    localStorage.setItem('theme-mode', next)
    applyTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches)
  }

  return <SegmentedControl options={OPTIONS} value={mode} onChange={change} />
}

export function applyTheme(mode: ThemeMode, systemDark: boolean): void {
  document.documentElement.classList.toggle('dark', resolveDarkMode(mode, systemDark))
}

export function resolveDarkMode(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark)
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}
