'use client'

import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '@/lib/utils'
import { OverlayRoot } from './overlay-root'

export interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  side?: 'top' | 'bottom'
  /** When false, platform light dismiss and Escape are disabled. */
  dismissible?: boolean
  role?: 'dialog' | 'menu'
  ariaLabel?: string
  className?: string
  contentClassName?: string
  contentRef?: RefObject<HTMLDivElement | null>
  onContentKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

type Coords = { top: number; left: number }
const VIEWPORT_MARGIN = 16
const DEFAULT_CONTENT_WIDTH = 320

/**
 * 触发器矩形锚定的 top-layer 弹出层（SSOT）。
 * 定位仍由 JS 负责；原生 Popover 提供层叠、light dismiss、Escape 与同级互斥。
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  dismissible = true,
  role = 'dialog',
  ariaLabel,
  className,
  contentClassName,
  contentRef,
  onContentKeyDown,
}: PopoverProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const internalContentRef = useRef<HTMLDivElement>(null)
  const surfaceRef = contentRef ?? internalContentRef
  const [coords, setCoords] = useState<Coords | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    function updatePosition() {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const contentWidth = surfaceRef.current?.offsetWidth || DEFAULT_CONTENT_WIDTH
      const preferredLeft = align === 'end' ? rect.right - contentWidth : rect.left
      const maxLeft = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - contentWidth - VIEWPORT_MARGIN,
      )
      setCoords({
        top: side === 'bottom' ? rect.bottom + 8 : rect.top - 8,
        left: Math.min(maxLeft, Math.max(VIEWPORT_MARGIN, preferredLeft)),
      })
    }
    updatePosition()
    const frame = requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [align, open, side, surfaceRef])

  const translateY = side === 'top' ? '-100%' : '0'

  return (
    <div ref={anchorRef} className={cn('relative inline-flex', className)}>
      {trigger}
      <OverlayRoot
        mode="popover"
        open={open && coords !== null}
        onOpenChange={onOpenChange}
        dismissal={dismissible ? 'auto' : 'manual'}
        role={role}
        ariaLabel={ariaLabel}
        surfaceRef={surfaceRef}
        onKeyDown={onContentKeyDown}
        style={{
          top: coords?.top ?? 0,
          left: coords?.left ?? 0,
          translate: `0 ${translateY}`,
          transformOrigin: `${align === 'end' ? 'right' : 'left'} ${
            side === 'top' ? 'bottom' : 'top'
          }`,
        }}
        className={cn(
          'fixed w-[320px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
          contentClassName,
        )}
      >
        {children}
      </OverlayRoot>
    </div>
  )
}
