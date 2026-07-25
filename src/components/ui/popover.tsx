'use client'

import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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

const subscribeToClient = () => () => undefined

/**
 * 锚定弹出层（SSOT）。
 * 内容 portal 到 document.body，层级高于页面媒体预览等后绘区块。
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
  const anchorRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  )

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      setCoords({
        top: rect.bottom + 8,
        left: align === 'end' ? rect.right : rect.left,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, align])

  return (
    <div ref={anchorRef} className={cn('relative inline-flex', className)}>
      {trigger}
      {open && mounted && coords
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="关闭弹出层"
                className="fixed inset-0 z-[1000] cursor-default bg-transparent"
                onClick={() => {
                  if (dismissible) onOpenChange(false)
                }}
              />
              <div
                role="dialog"
                aria-modal="false"
                className={cn(
                  'fixed z-[1001] w-[320px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
                  contentClassName,
                )}
                style={
                  align === 'end'
                    ? { top: coords.top, left: coords.left, transform: 'translateX(-100%)' }
                    : { top: coords.top, left: coords.left }
                }
              >
                {children}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}
