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
 * canvas.pen Canonical: ds-surface 底、上边框、高 40px、px-3.5。
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
        'flex h-10 items-center justify-between border-t border-ds-border bg-ds-surface px-3.5 text-ds-text',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <LoaderCircle
          className={cn(
            'size-3.5 text-ds-blue',
            active > 0 && 'animate-spin'
          )}
        />
        <span className="text-xs text-ds-text-muted">
          {label ?? `Pipeline · 已提交 ${completed} / ${total} 个检查点`}
        </span>
        <div className="h-1 w-[120px] rounded-full bg-ds-surface-muted">
          <div className="h-1 rounded-full bg-ds-blue" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <span className="text-xs text-ds-text-muted">
        {describeQueueActivity({ completed, active, failed, total })}
      </span>
    </div>
  )
}
