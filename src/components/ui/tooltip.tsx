import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  className?: string
}

/**
 * 简单 Tooltip（SSOT）。
 * canvas.pen: tooltip-bg 底、rounded-sm、px-2 py-1、text-on-accent 12px。
 *
 * 注意：本组件仅提供静态样式壳；实际悬停触发请配合父级使用。
 */
export function Tooltip({ children, content, className }: TooltipProps) {
  return (
    <div className={cn('group relative inline-flex', className)}>
      {children}
      <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-tooltip-bg px-2 py-1 text-xs font-sc text-on-accent opacity-0 transition-opacity group-hover:opacity-100">
        {content}
      </div>
    </div>
  )
}
