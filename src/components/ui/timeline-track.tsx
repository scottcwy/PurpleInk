import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TimelineClipSpan {
  /** 起点占轨道可用宽度的比例（0..1）。 */
  start: number
  /** 时长占轨道可用宽度的比例（0..1）——宽度即时长，不是常量。 */
  width: number
  label: string
}

export interface TimelineTrackProps {
  icon: ComponentType<{ className?: string }>
  /**
   * 轨道名，控制在两个字以内。
   *
   * 轨道头宽度固定，一整句状态（如「字幕就绪 3/5」）塞进来只会换行然后被
   * 40px 行高裁掉。计数走 `meta`，完整说明走 `title`。
   */
  label: string
  clips: TimelineClipSpan[]
  /** 轨道头右侧的等宽短状态，如 `3/5`。 */
  meta?: string
  /** 轨道右侧的操作位：字幕开关，或音乐/音效的「接口预留」徽章。 */
  action?: ReactNode
  /** 完整语义，挂在行上供悬停查看，不占版面。 */
  title?: string
  /**
   * 降饱和态（本次不入片 / 接口预留）。
   *
   * 必须同时提供 `emptyLabel` 或 `meta` 之类的文本语义：状态不能只靠颜色表达。
   */
  muted?: boolean
  /** 无 clip 时在轨道区内显示的说明；不给则留空轨道。 */
  emptyLabel?: string
  className?: string
}

/**
 * 时间线轨道（SSOT）。
 *
 * 轨道区高 32px、`ds-surface-muted` 底、6px 圆角、3px 内衬；clip 按比例定位，
 * 宽度直接编码时长。全族只用一个彩色色相（`ds-blue`），对比度实测浅色
 * 4.89:1、暗色 6.78:1，均过 4.5:1。
 */
export function TimelineTrack({
  icon: Icon,
  label,
  clips,
  meta,
  action,
  title,
  muted = false,
  emptyLabel,
  className,
}: TimelineTrackProps) {
  return (
    <div
      className={cn('flex h-10 items-center gap-3', className)}
      {...(title ? { title } : {})}
    >
      <div className="flex w-[124px] shrink-0 items-center gap-2">
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            muted ? 'text-ds-text-muted' : 'text-ds-blue',
          )}
        />
        <span className="text-xs text-ds-text">{label}</span>
        {meta && (
          <span className="ml-auto font-mono text-xs text-ds-text-muted">
            {meta}
          </span>
        )}
      </div>
      <div className="relative h-8 min-w-0 flex-1 rounded-md bg-ds-surface-muted p-[3px]">
        {clips.length === 0 && emptyLabel && (
          <span className="flex h-full items-center px-2 text-xs text-ds-text-muted">
            {emptyLabel}
          </span>
        )}
        {clips.map((clip) => (
          <div
            key={`${clip.label}-${String(clip.start)}`}
            className={cn(
              'absolute inset-y-[3px] flex items-center overflow-hidden rounded px-2',
              muted
                ? 'bg-ds-surface text-ds-text-muted'
                : 'bg-ds-blue-soft text-ds-blue',
            )}
            style={{
              left: `calc(${percent(clip.start)} + 3px)`,
              width: `calc(${percent(clip.width)} - 3px)`,
            }}
          >
            <span className="truncate text-xs">{clip.label}</span>
          </div>
        ))}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </div>
  )
}

function percent(ratio: number): string {
  const clamped = Math.min(Math.max(ratio, 0), 1)
  return `${(clamped * 100).toFixed(4)}%`
}
