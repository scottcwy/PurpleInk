'use client'

import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

const subscribeToClient = () => () => undefined

/**
 * 模态对话框（SSOT）。
 * canvas.pen S2: ds-surface 底、10px 圆角、40px 浮层阴影、垂直布局、
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
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  )

  if (!open || !mounted) return null

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-[color:var(--ds-scrim)] px-4 py-[108px] backdrop-blur-[20px]"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex w-[600px] max-w-full flex-col gap-[18px] rounded-[10px] border border-ds-border bg-ds-surface p-6 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
          className,
        )}
      >
        {title && <h2 className="text-[22px] font-bold">{title}</h2>}
        {description && (
          <p className="text-sm leading-[1.45] text-ds-text-muted">{description}</p>
        )}
        {children}
        {actions && <div className="flex justify-end gap-2.5">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
