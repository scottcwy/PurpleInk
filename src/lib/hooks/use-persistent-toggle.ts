'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 布尔偏好持久化到 localStorage。
 * SSR / 首帧使用 defaultValue，mount 后读盘修正。
 */
export function usePersistentToggle(
  storageKey: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === 'true' || stored === 'false') {
        queueMicrotask(() => setValue(stored === 'true'))
      }
    } catch {
      // private mode / SSR — keep default
    }
  }, [storageKey])

  const setPersistent = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(storageKey, String(next))
      } catch {
        // ignore write failures
      }
    },
    [storageKey],
  )

  return [value, setPersistent]
}
