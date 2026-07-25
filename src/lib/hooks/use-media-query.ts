'use client'

import { useEffect, useState } from 'react'

/**
 * 订阅 `window.matchMedia`。
 * SSR / 首帧默认 `false`，mount 后同步真实值（与 ThemeControl 同策略）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}
