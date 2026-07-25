import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface TimelineTrackProps {
  icon: ComponentType<{ className?: string }>
  label: string
  clips: { start: number; width: number; label: string }[]
  color?: string
  className?: string
}

/**
 * 时间线轨道（SSOT）。
 * canvas.pen: 高 10（40px）、左侧 72px 轨道头 + 右侧 fill 轨道区；
 * 轨道内按起始位置摆放 Clip。
 */
export function TimelineTrack({
  icon: Icon,
  label,
  clips,
  color = 'bg-stage-shot',
  className,
}: TimelineTrackProps) {
  return (
    <div className={cn('flex h-10 items-center', className)}>
      <div className="flex w-[72px] items-center gap-1">
        <Icon className="h-3.5 w-3.5 text-label-secondary" />
        <span className="text-xs font-sc text-label-secondary">{label}</span>
      </div>
      <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-fill">
        {clips.map((clip, i) => (
          <div
            key={i}
            className={cn(
              'absolute top-1 flex h-6 items-center rounded px-1.5 text-[11px] font-sc text-text-inverse',
              color,
            )}
            style={{ left: `${clip.start}px`, width: `${clip.width}px` }}
          >
            {clip.label}
          </div>
        ))}
      </div>
    </div>
  )
}
