import type { LucideIcon } from 'lucide-react'
import { FileCode, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export type PipelineNodeStatus =
  | 'unwired'
  | 'ready'
  | 'running'
  | 'completed'
  | 'blocked'

const STATUS_STYLES: Record<
  PipelineNodeStatus,
  { label: string; className: string }
> = {
  unwired: { label: '未接线', className: 'bg-ds-surface-muted text-ds-text-muted' },
  ready: { label: '就绪', className: 'bg-ds-blue-soft text-ds-blue' },
  running: { label: '运行中', className: 'bg-ds-blue-soft text-ds-blue' },
  completed: { label: '已完成', className: 'bg-ds-green-soft text-ds-green' },
  blocked: { label: '已阻塞', className: 'bg-ds-red-soft text-ds-red' },
}

export interface PipelineNodeProps {
  title: string
  meta: string
  status?: PipelineNodeStatus
  artifact?: string
  icon?: LucideIcon
  className?: string
}

export function PipelineNode({
  title,
  meta,
  status = 'unwired',
  artifact,
  icon: Icon = Sparkles,
  className,
}: PipelineNodeProps) {
  const statusStyle = STATUS_STYLES[status]

  return (
    <article
      className={cn(
        'w-[190px] rounded-lg border border-ds-border bg-ds-surface p-3.5 text-ds-text shadow-[0_1px_2px_#25305a0d] backdrop-blur-xl',
        className,
      )}
    >
      <header className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ds-blue-soft text-ds-blue">
          <Icon aria-hidden className="size-[15px]" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-semibold">{title}</strong>
          <span className="block truncate font-mono text-[11px] text-ds-text-muted">
            {meta}
          </span>
        </span>
      </header>
      <div className="mt-3 flex min-w-0 gap-2">
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ds-border px-2 py-1 text-[11px] font-semibold',
            statusStyle.className,
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {statusStyle.label}
        </span>
        {artifact ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-ds-border bg-ds-surface-muted px-2 py-1 font-mono text-[10px]">
            <FileCode aria-hidden className="size-3 shrink-0 text-ds-text-muted" />
            <span className="truncate">{artifact}</span>
          </span>
        ) : null}
      </div>
    </article>
  )
}
