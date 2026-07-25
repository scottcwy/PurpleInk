'use client'

import type { KeyboardEvent, PointerEvent } from 'react'
import { cn } from '@/lib/utils'

export interface ResizeHandleProps {
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void
  onKeyAdjust?: (delta: number) => void
  isDragging?: boolean
  'aria-label'?: string
  className?: string
  /** 键盘微调步长（px），默认 8 */
  step?: number
}

/**
 * 分栏拖拽手柄（SSOT 交互原语）。
 * 默认透明，hover/active 时显示 accent 指示条；
 * 不含拖拽逻辑，由父级通过 onPointerDown / onKeyAdjust 接入。
 */
export function ResizeHandle({
  onPointerDown,
  onKeyAdjust,
  isDragging,
  'aria-label': ariaLabel = '调节面板宽度',
  className,
  step = 8,
}: ResizeHandleProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!onKeyAdjust) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onKeyAdjust(-step)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onKeyAdjust(step)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 w-1 shrink-0 cursor-col-resize touch-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
        className,
      )}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-pill bg-transparent transition-colors',
          'group-hover:bg-accent group-focus-visible:bg-accent',
          isDragging && 'bg-accent',
        )}
      />
    </div>
  )
}
