'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  /** When false, outside dismiss is disabled (e.g. export in progress). */
  dismissible?: boolean
  className?: string
  contentClassName?: string
}

/**
 * 锚定弹出层（SSOT）。
 * 挂在 trigger 下方，轻量二次交互；非模态，无全屏 scrim。
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'end',
  dismissible = true,
  className,
  contentClassName,
}: PopoverProps) {
  return (
    <div className={cn('relative inline-flex', className)}>
      {trigger}
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭弹出层"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => {
              if (dismissible) onOpenChange(false)
            }}
          />
          <div
            role="dialog"
            aria-modal="false"
            className={cn(
              'absolute top-full z-50 mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
              align === 'end' ? 'right-0' : 'left-0',
              contentClassName,
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}
