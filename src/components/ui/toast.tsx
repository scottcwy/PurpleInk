'use client'

import type { ComponentType, ReactNode } from 'react'
import { X, Info, CircleCheck, TriangleAlert, CircleX } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToastVariant } from './toast-store'

export { toast } from './toast-store'
export type { ToastVariant } from './toast-store'

export interface ToastProps {
  variant?: ToastVariant
  title: ReactNode
  body?: ReactNode
  onClose?: () => void
  className?: string
}

const ICONS: Record<ToastVariant, ComponentType<{ className?: string }>> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
}

const ICON_COLORS: Record<ToastVariant, string> = {
  info: 'text-ds-blue',
  success: 'text-ds-green',
  warning: 'text-ds-amber',
  error: 'text-ds-red',
}

/**
 * Toast 通知条（SSOT）。
 * canvas.pen: glass 底、rounded-lg、backdrop-blur-[20px]、shadow-float、
 * 20px 状态图标 + 标题/正文 + 关闭图标。
 */
export function Toast({ variant = 'info', title, body, onClose, className }: ToastProps) {
  const Icon = ICONS[variant]
  return (
    <div
      className={cn(
        'flex w-[360px] items-start gap-2.5 rounded-lg border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-[20px]',
        className,
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', ICON_COLORS[variant])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold">{title}</span>
        {body && <span className="text-xs text-ds-text-muted">{body}</span>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭通知"
          className="shrink-0 text-ds-text-muted transition-colors duration-fast ease-standard hover:text-ds-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
