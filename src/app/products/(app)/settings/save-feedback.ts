'use client'

import { useEffect, useRef, useState } from 'react'

export type SaveState = 'idle' | 'success' | 'error'

/** 保存后的内联状态反馈；3 秒后自动回落 idle。 */
export function useSaveFeedback() {
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function report(ok: boolean) {
    setState(ok ? 'success' : 'error')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 3000)
  }

  return { state, report }
}
