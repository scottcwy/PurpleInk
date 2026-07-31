import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TopBarProps {
  title?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * 页面顶栏（SSOT）。
 * ds-surface 底、下边框、高 48px、px-7、
 * 左右两端分布：左侧标题 + 元信息，右侧操作区。
 */
export function TopBar({ title, meta, actions, className }: TopBarProps) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center justify-between border-b border-ds-border bg-ds-surface px-4 text-ds-text backdrop-blur-xl sm:px-7',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {title && <span className="text-[17px] font-semibold">{title}</span>}
        {meta && <span className="text-xs text-ds-text-muted">{meta}</span>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
