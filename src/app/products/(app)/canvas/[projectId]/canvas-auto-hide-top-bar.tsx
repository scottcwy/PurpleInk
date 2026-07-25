'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TopBar } from '@/components/ui/top-bar'
import { cn } from '@/lib/utils'

const HIDE_DELAY_MS = 300

/**
 * 画布顶栏：默认藏在上方；指针靠近顶缘或进入顶栏时缓出，离开后延迟收回。
 * focus-within 时保持展开，保证键盘可达。
 */
export function CanvasAutoHideTopBar({
  title,
  meta,
  actions,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearHideTimer() {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  function show() {
    clearHideTimer()
    setVisible(true)
  }

  function scheduleHide() {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      setVisible(false)
      hideTimerRef.current = null
    }, HIDE_DELAY_MS)
  }

  useEffect(() => () => clearHideTimer(), [])

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-auto absolute inset-x-0 top-0 z-30 h-4"
        onMouseEnter={show}
      />
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-40 transition-transform duration-[var(--duration-base)] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          visible
            ? 'pointer-events-auto translate-y-0'
            : 'pointer-events-none -translate-y-full',
        )}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocusCapture={show}
        onBlurCapture={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          scheduleHide()
        }}
      >
        <TopBar title={title} meta={meta} actions={actions} />
      </div>
    </>
  )
}
