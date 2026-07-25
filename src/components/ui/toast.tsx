'use client'

import type { ComponentType, ReactNode } from 'react'
import { X, Info, CircleCheck, TriangleAlert, CircleX } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

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
  info: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
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
        'flex w-[360px] items-start gap-2.5 rounded-lg bg-glass p-3 shadow-float backdrop-blur-[20px]',
        className,
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', ICON_COLORS[variant])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-semibold font-sc text-label">{title}</span>
        {body && <span className="text-xs font-sc text-label-secondary">{body}</span>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-label-tertiary transition-colors hover:text-label"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

interface ToastItem {
  id: string
  variant: ToastVariant
  title: ReactNode
  body?: ReactNode
}

let listeners: ((toasts: ToastItem[]) => void)[] = []
let toasts: ToastItem[] = []

function notify() {
  listeners.forEach((listener) => listener([...toasts]))
}

/** 全局 toast 调用入口（最小可用）。 */
export const toast = {
  show(variant: ToastVariant, title: ReactNode, body?: ReactNode) {
    const id = crypto.randomUUID()
    toasts = [...toasts, { id, variant, title, body }]
    notify()
  },
  dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id)
    notify()
  },
  subscribe(listener: (toasts: ToastItem[]) => void) {
    listeners.push(listener)
    listener([...toasts])
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  },
}
