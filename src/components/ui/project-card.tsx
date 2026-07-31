import { Film } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusPill } from './status-pill'

export interface ProjectCardProps {
  title: string
  meta: string
  status?: 'pending' | 'generating' | 'recovering' | 'rendered' | 'cached' | 'failed'
  className?: string
}

/**
 * 项目卡片（SSOT）。
 * canvas.pen Canonical: 340 宽、ds-surface 底、8px 圆角；
 * 150px 预览 + 16px 信息区。
 */
export function ProjectCard({ title, meta, status = 'rendered', className }: ProjectCardProps) {
  return (
    <div
      className={cn(
        'flex w-[340px] max-w-full flex-col overflow-hidden rounded-lg border border-ds-border bg-ds-surface text-ds-text',
        className,
      )}
    >
      <div className="relative flex h-[150px] items-center justify-center bg-ds-surface-muted">
        <Film className="size-7 text-ds-text-muted" />
        <div className="absolute left-3 top-3">
          <StatusPill variant={status} />
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <span className="text-[15px] font-semibold text-ds-text">{title}</span>
        <span className="text-xs text-ds-text-muted">{meta}</span>
      </div>
    </div>
  )
}
