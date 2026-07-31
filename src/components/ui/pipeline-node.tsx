import type { LucideIcon } from 'lucide-react'
import { FileCode, Sparkles } from 'lucide-react'
import { StatusPill } from '@/components/ui/status-pill'
import { nodeTypeBorderClass } from '@/components/ui/node/stage-colors'
import {
  getNodeStatusLabel,
  getNodeStatusPresentation,
} from '@/components/ui/pipeline-node-status'
import type { CanvasNodeType, NodeStatus } from '@/features/canvas/types'
import { cn } from '@/lib/utils'

export interface PipelineNodeProps {
  title: string
  meta?: string
  nodeType: CanvasNodeType
  status?: NodeStatus
  /** 覆盖默认状态文案（如泳道折叠：「已折叠 · 5 节点」）。 */
  statusLabel?: string
  selected?: boolean
  artifact?: string
  icon?: LucideIcon
  className?: string
}

/**
 * DAG 节点壳（Canonical / Qsovp）。
 * 尺寸对齐画布布局 220×100；状态用领域 NodeStatus；选中态用 ds-blue ring。
 */
export function PipelineNode({
  title,
  meta,
  nodeType,
  status = 'idle',
  statusLabel,
  selected = false,
  artifact,
  icon: Icon = Sparkles,
  className,
}: PipelineNodeProps) {
  const presentation = getNodeStatusPresentation(status)
  const stageBorder = nodeTypeBorderClass(nodeType)

  return (
    <article
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'box-border flex h-[100px] w-[220px] flex-col justify-between rounded-lg border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl',
        selected
          ? 'border-ds-blue ring-2 ring-ds-blue/35'
          : cn('border-ds-border', stageBorder),
        className,
      )}
    >
      <header className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-ds-blue-soft text-ds-blue">
          <Icon aria-hidden className="size-[15px]" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm font-semibold">{title}</strong>
          {meta ? (
            <span className="block truncate font-mono text-[11px] text-ds-text-muted">
              {meta}
            </span>
          ) : null}
        </span>
      </header>
      <div className="flex min-w-0 gap-2">
        <StatusPill
          variant={presentation.variant}
          icon={presentation.icon}
          label={statusLabel ?? getNodeStatusLabel(nodeType, status)}
        />
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
