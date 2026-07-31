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
 * <640px 内容放不下时允许换行增高（min-h 仍为 48px）；
 * <900px 标题区加左侧留白，避让 app-sidebar-shell 的悬浮「打开导航」钮
 * （fixed 左上角、<lg 为 40×40，右缘 48px；断点对齐 BP_SIDEBAR_HIDDEN=900）。
 */
export function TopBar({ title, meta, actions, className }: TopBarProps) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center justify-between border-b border-ds-border bg-ds-surface px-4 text-ds-text backdrop-blur-xl max-sm:h-auto max-sm:min-h-12 max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-1.5 sm:px-7',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 max-[899px]:pl-10">
        {title && <span className="text-[17px] font-semibold">{title}</span>}
        {meta && <span className="text-xs text-ds-text-muted">{meta}</span>}
      </div>
      {actions && (
        <div className="flex items-center gap-2 max-sm:flex-wrap">{actions}</div>
      )}
    </div>
  )
}
