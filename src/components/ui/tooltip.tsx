'use client'

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { OverlayRoot } from './overlay-root'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  className?: string
}

const TOOLTIP_OPEN_DELAY_MS = 300
const TOOLTIP_OFFSET_PX = 4

/**
 * Tooltip（SSOT）：300ms 延迟进入、立即退出，并使用手动 Popover top layer
 * 避免侧栏等 overflow 容器裁切。
 */
export function Tooltip({ children, content, className }: TooltipProps) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setCoords({
      top: rect.bottom + TOOLTIP_OFFSET_PX,
      left: rect.left + rect.width / 2,
    })
  }, [])

  const scheduleOpen = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      updatePosition()
      setOpen(true)
    }, TOOLTIP_OPEN_DELAY_MS)
  }, [clearTimer, updatePosition])

  const close = useCallback(() => {
    clearTimer()
    setOpen(false)
  }, [clearTimer])

  useLayoutEffect(() => {
    if (!open) return
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => clearTimer, [clearTimer])

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    close()
  }

  return (
    <div
      ref={triggerRef}
      className={cn('relative inline-flex', className)}
      aria-describedby={open ? tooltipId : undefined}
      onPointerEnter={scheduleOpen}
      onPointerLeave={close}
      onFocus={scheduleOpen}
      onBlur={handleBlur}
    >
      {children}
      <OverlayRoot
        mode="popover"
        dismissal="manual"
        preset="tooltip"
        open={open && coords !== null}
        onOpenChange={setOpen}
        role="tooltip"
        id={tooltipId}
        className="pointer-events-none fixed whitespace-nowrap rounded-sm bg-tooltip-bg px-2 py-1 text-xs text-on-accent"
        style={{
          top: coords?.top ?? 0,
          left: coords?.left ?? 0,
          translate: '-50% 0',
          transformOrigin: 'top center',
        }}
      >
        {content}
      </OverlayRoot>
    </div>
  )
}
