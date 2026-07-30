import {
  CircleCheck,
  Clock3,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface QueueStatusBarProps {
  completed: number
  active: number
  waiting: number
  failed: number
  total: number
  label?: string
  className?: string
}

export interface QueueActivity {
  completed: number
  active: number
  waiting: number
  failed: number
  total: number
}

export function describeQueueActivity(input: QueueActivity): string {
  if (input.failed > 0) return `${input.failed} 个节点失败`
  if (input.waiting > 0) return `${input.waiting} 个节点等待恢复`
  if (input.active > 0) return `${input.active} 个节点执行中`
  if (input.total > 0 && input.completed === input.total) {
    return '全部节点已完成'
  }
  return '等待执行'
}

export type QueueActivityState =
  | 'failed'
  | 'waiting'
  | 'active'
  | 'complete'
  | 'idle'

export function queueActivityState(input: QueueActivity): QueueActivityState {
  if (input.failed > 0) return 'failed'
  if (input.waiting > 0) return 'waiting'
  if (input.active > 0) return 'active'
  if (input.total > 0 && input.completed === input.total) return 'complete'
  return 'idle'
}

/**
 * 渲染队列状态条（SSOT）。
 * canvas.pen Canonical: ds-surface 底、上边框、高 40px、px-3.5。
 */
export function QueueStatusBar({
  completed,
  active,
  waiting,
  failed,
  total,
  label,
  className,
}: QueueStatusBarProps) {
  const boundedCompleted = Math.min(Math.max(completed, 0), total)
  const percent = total > 0 ? Math.round((boundedCompleted / total) * 100) : 0
  const activity = { completed, active, waiting, failed, total }
  const state = queueActivityState(activity)
  const Icon = {
    failed: TriangleAlert,
    waiting: Clock3,
    active: LoaderCircle,
    complete: CircleCheck,
    idle: Clock3,
  }[state]
  const iconTone = {
    failed: 'text-ds-red',
    waiting: 'text-ds-amber',
    active: 'text-ds-blue',
    complete: 'text-ds-green',
    idle: 'text-ds-text-muted',
  }[state]
  const progressTone = {
    failed: 'bg-ds-red',
    waiting: 'bg-ds-amber',
    active: 'bg-ds-blue',
    complete: 'bg-ds-green',
    idle: 'bg-ds-text-muted',
  }[state]
  return (
    <div
      data-state={state}
      className={cn(
        'flex h-10 items-center justify-between border-t border-ds-border bg-ds-surface px-3.5 text-ds-text',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden
          className={cn(
            'size-3.5',
            iconTone,
            state === 'active' && 'animate-spin'
          )}
        />
        <span className="text-xs text-ds-text-muted">
          {label ?? `Pipeline · 已提交 ${completed} / ${total} 个检查点`}
        </span>
        <div className="h-1 w-[120px] rounded-full bg-ds-surface-muted">
          <div
            className={cn('h-1 rounded-full', progressTone)}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <span className="text-xs text-ds-text-muted">
        {describeQueueActivity(activity)}
      </span>
    </div>
  )
}
