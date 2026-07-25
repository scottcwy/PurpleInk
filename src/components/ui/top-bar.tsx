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
 * canvas.pen: surface 底、下边框 separator、高 14（56px）、px-4、
 * 左右两端分布：左侧标题 + 元信息，右侧操作区。
 */
export function TopBar({ title, meta, actions, className }: TopBarProps) {
  return (
    <div
      className={cn(
        'flex h-14 items-center justify-between border-b border-separator bg-surface px-4',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {title && <span className="text-[17px] font-semibold font-sc text-label">{title}</span>}
        {meta && <span className="text-xs font-sc text-label-tertiary">{meta}</span>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
