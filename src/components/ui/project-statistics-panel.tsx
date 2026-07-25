import { Activity, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProjectMetric {
  label: string
  value?: string
  source: string
}

export interface ProjectStatisticsPanelProps {
  metrics?: readonly ProjectMetric[]
  updatedLabel?: string
  className?: string
}

const EMPTY_METRICS: readonly ProjectMetric[] = [
  { label: '项目总数', source: 'projects.total' },
  { label: '活跃 Pipeline', source: 'pipelines.active' },
  { label: '已提交 Artifact', source: 'artifacts.committed' },
  { label: '平均镜头数', source: 'shots.average' },
]

export function ProjectStatisticsPanel({
  metrics = EMPTY_METRICS,
  updatedLabel = '等待 WorkspaceStatisticsSnapshotV1',
  className,
}: ProjectStatisticsPanelProps) {
  return (
    <section
      className={cn(
        'grid min-h-[350px] overflow-hidden rounded-lg border border-ds-border bg-ds-surface text-ds-text backdrop-blur-xl md:grid-cols-[176px_minmax(0,1fr)]',
        className,
      )}
    >
      <aside className="flex flex-col gap-1.5 border-b border-ds-border bg-ds-surface-muted p-3.5 md:border-b-0 md:border-r">
        <p className="text-[10px] font-semibold text-ds-text-muted">统计视图</p>
        <div className="flex h-[34px] items-center gap-2 rounded-md bg-ds-blue-soft px-2.5 text-xs font-semibold">
          <BarChart3 aria-hidden className="size-4 text-ds-primary" />
          项目统计
        </div>
        <div className="flex h-[34px] items-center gap-2 px-2.5 text-xs text-ds-text-muted">
          <Activity aria-hidden className="size-4" />
          API 调用统计
        </div>
        <div className="mt-auto hidden md:block">
          <p className="font-mono text-[8px] font-semibold text-ds-text-muted">
            DATA SOURCE
          </p>
          <p className="mt-0.5 break-all font-mono text-[8px]">
            WorkspaceStatisticsSnapshotV1
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col gap-2.5 p-3.5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <h2 className="text-base font-bold">项目统计</h2>
            <p className="text-[10px] text-ds-text-muted">
              项目吞吐、执行状态与交付产物的持久快照。
            </p>
          </span>
          <span className="font-mono text-[9px] text-ds-text-muted">{updatedLabel}</span>
        </header>
        <div className="grid min-h-14 grid-cols-2 border-y border-ds-border lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.source}
              className="flex min-w-0 flex-col justify-center border-r border-ds-border px-2.5 py-1.5 last:border-r-0"
            >
              <span className="text-[9px] text-ds-text-muted">{metric.label}</span>
              <strong className="font-mono text-base">{metric.value ?? '—'}</strong>
              <span className="truncate font-mono text-[7px] text-ds-text-muted">
                {metric.source}
              </span>
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <EmptyTrend />
          <EmptyStatus />
        </div>
      </div>
    </section>
  )
}

function EmptyTrend() {
  return (
    <div className="flex min-h-40 flex-col gap-1.5">
      <div>
        <h3 className="text-xs font-semibold">项目完成趋势</h3>
        <p className="text-[8px] text-ds-text-muted">最近 7 天完成与发布的项目</p>
      </div>
      <div className="ds-dot-grid flex flex-1 items-center justify-center rounded-md border border-ds-border">
        <span className="rounded-full bg-ds-surface px-3 py-1.5 text-[10px] text-ds-text-muted">
          该统计尚未接线（Stage B）
        </span>
      </div>
    </div>
  )
}

function EmptyStatus() {
  return (
    <div className="flex min-h-40 flex-col rounded-md bg-ds-surface-muted p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold">状态分布</h3>
        <span className="text-[8px] text-ds-text-muted">最近 7 天</span>
      </div>
      <div className="flex flex-1 items-center justify-center text-center text-[10px] text-ds-text-muted">
        等待 projectStats.status7d
      </div>
      <code className="text-[7px] text-ds-text-muted">projectStats.status7d</code>
    </div>
  )
}
