import {
  Ban,
  CheckCircle2,
  Circle,
  CircleX,
  Clock3,
  LoaderCircle,
  ShieldAlert,
} from 'lucide-react'
import type {
  ProjectExecutionSnapshot,
  WebsiteStageSnapshot,
} from '@/features/projects'
import { websiteStagePresentation } from '@/features/projects/website-execution-presentation'
import { cn } from '@/lib/utils'

export function WebsiteExportStageList({
  execution,
}: {
  execution: ProjectExecutionSnapshot
}) {
  return (
    <section
      aria-label="网站视频执行阶段"
      className="rounded-xl border border-ds-border bg-ds-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ds-text">六阶段交付进度</h2>
      <ol className="mt-3 grid gap-2">
        {execution.stages.map((stage, index) => {
          const presentation = websiteStagePresentation(
            execution,
            stage,
            index,
          )
          const Icon = stateIcon(stage.state)
          return (
            <li
              key={stage.nodeId}
              className="flex items-start gap-3 rounded-lg border border-ds-border-subtle bg-ds-surface-muted px-3 py-2.5"
            >
              <Icon
                aria-hidden
                className={cn('mt-0.5 size-4 shrink-0', iconClass(stage.state))}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-ds-text">
                    {presentation.title}
                  </span>
                  <time
                    dateTime={stage.updatedAt}
                    className="shrink-0 text-[10px] font-mono text-ds-text-muted"
                  >
                    {formatTimestamp(stage.updatedAt)}
                  </time>
                </div>
                <p className="mt-0.5 text-[11px] text-ds-text-muted">
                  {presentation.status}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function stateIcon(state: WebsiteStageSnapshot['state']) {
  if (state === 'succeeded') return CheckCircle2
  if (state === 'running') return LoaderCircle
  if (state === 'queued') return Clock3
  if (state === 'blocked') return ShieldAlert
  if (state === 'failed') return CircleX
  if (state === 'cancelled') return Ban
  return Circle
}

function iconClass(state: WebsiteStageSnapshot['state']): string {
  if (state === 'succeeded') return 'text-status-success'
  if (state === 'running' || state === 'queued') return 'text-status-info'
  if (state === 'blocked') return 'text-status-warning'
  if (state === 'failed') return 'text-status-error'
  return 'text-ds-text-muted'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}
