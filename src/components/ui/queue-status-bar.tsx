import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface QueueStatusBarProps {
  completed: number
  active: number
  failed: number
  total: number
  label?: string
  className?: string
}

export interface QueueActivity {
  completed: number
  active: number
  failed: number
  total: number
}

export function describeQueueActivity(input: QueueActivity): string {
  if (input.failed > 0) return `${input.failed} 个节点失败`
  if (input.active > 0) return `${input.active} 个节点执行中`
  if (input.total > 0 && input.completed === input.total) {
    return '全部节点已完成'
  }
  return '等待执行'
}

/**
 * 渲染队列状态条（SSOT）。
 * canvas.pen: surface 底、上边框 separator、h-9、px-4；
 * 左侧 loader + 标签 + 迷你进度，右侧辅助信息。
 */
export function QueueStatusBar({
  completed,
  active,
  failed,
  total,
  label,
  className,
}: QueueStatusBarProps) {
  const boundedCompleted = Math.min(Math.max(completed, 0), total)
  const percent = total > 0 ? Math.round((boundedCompleted / total) * 100) : 0
  return (
    <div
      className={cn(
        'flex h-9 items-center justify-between border-t border-separator bg-surface px-4',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <LoaderCircle
          className={cn(
            'h-3.5 w-3.5 text-accent',
            active > 0 && 'animate-spin'
          )}
        />
        <span className="text-xs font-sc text-label-secondary">
          {label ?? `渲染队列 · ${completed}/${total} 节点完成`}
        </span>
        <div className="h-1 w-[120px] rounded-sm bg-fill">
          <div className="h-1 rounded-sm bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <span className="text-xs font-sc text-label-tertiary">
        {describeQueueActivity({ completed, active, failed, total })}
      </span>
    </div>
  )
}
