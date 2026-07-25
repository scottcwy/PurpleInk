import { Film } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusPill } from './status-pill'

export interface ProjectCardProps {
  title: string
  meta: string
  status?: 'pending' | 'generating' | 'rendered' | 'cached' | 'failed'
  className?: string
}

/**
 * 项目卡片（SSOT）。
 * canvas.pen: 280 宽、surface 底、rounded-lg、shadow-card；
 * 168px 缩略图 + 信息区。
 */
export function ProjectCard({ title, meta, status = 'rendered', className }: ProjectCardProps) {
  return (
    <div
      className={cn(
        'flex w-70 flex-col overflow-hidden rounded-lg bg-surface shadow-card',
        className,
      )}
    >
      <div className="relative flex h-42 items-center justify-center bg-fill">
        <Film className="h-8 w-8 text-label-tertiary" />
        <div className="absolute left-3 top-3">
          <StatusPill variant={status} />
        </div>
      </div>
      <div className="flex flex-col gap-1 p-3">
        <span className="text-[13px] font-semibold font-sc text-label">{title}</span>
        <span className="text-xs font-mono text-label-tertiary">{meta}</span>
      </div>
    </div>
  )
}
