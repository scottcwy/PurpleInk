'use client'

import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { OverlayRoot } from './overlay-root'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
  /** 弹窗在视口中的定位；默认 'top' 保持原有 108px 顶部偏移。 */
  placement?: 'top' | 'center'
}

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
  placement = 'top',
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <OverlayRoot
      mode="modal"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      ariaLabelledBy={title ? titleId : undefined}
      ariaDescribedBy={description ? descriptionId : undefined}
      layoutClassName={
        placement === 'top' ? 'items-start py-[108px]' : 'items-center py-8'
      }
      className={cn(
        'flex w-[600px] max-w-full flex-col gap-[18px] rounded-[10px] border border-ds-border bg-ds-surface p-6 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
        className,
      )}
    >
      {title && (
        <h2 id={titleId} className="text-[22px] font-bold">
          {title}
        </h2>
      )}
      {description && (
        <p
          id={descriptionId}
          className="text-sm leading-[1.45] text-ds-text-muted"
        >
          {description}
        </p>
      )}
      {children}
      {actions && <div className="flex justify-end gap-2.5">{actions}</div>}
    </OverlayRoot>
  )
}
