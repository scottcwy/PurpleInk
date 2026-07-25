'use client'

import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * 模态对话框（SSOT）。
 * canvas.pen: surface-raised 底、rounded-xl、shadow-float、垂直布局、
 * 标题 + 描述 + 内容槽 + 操作区。
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  className,
}: DialogProps) {
  if (!open) return null

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-[20px]"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex w-[480px] flex-col gap-4 rounded-xl bg-surface-raised p-6 shadow-float',
          className,
        )}
      >
        {title && <h2 className="text-[22px] font-semibold font-sc text-label">{title}</h2>}
        {description && <p className="text-[15px] font-sc text-label-secondary">{description}</p>}
        {children && <div className="min-h-20 rounded-sm bg-fill">{children}</div>}
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  )
}
