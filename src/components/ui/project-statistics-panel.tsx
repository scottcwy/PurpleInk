'use client'

import { Activity, BarChart3, LineChart } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { AiUsageProjectionV1 } from '@/features/usage/client'
import { cn } from '@/lib/utils'
import { ProjectStatisticsApiView } from './project-statistics-api-view'

export interface ProjectMetric {
  label: string
  value?: string
  source: string
}

export interface ProjectStatusDistribution {
  running: number
  failed: number
  succeeded: number
  idle: number
}

export interface ProjectStatisticsPanelProps {
  metrics?: readonly ProjectMetric[]
  statusDistribution?: ProjectStatusDistribution
  trendUnavailableLabel?: string
  updatedLabel?: string
  apiUsage: AiUsageProjectionV1 | null
  className?: string
}

const PLAYBOOK_HREF = '/playbook/ui#project-statistics-panel'

const EMPTY_METRICS: readonly ProjectMetric[] = [
  { label: '项目总数', source: 'projects.total' },
  { label: '活跃 Pipeline', source: 'pipelines.active' },
  { label: '已提交 Artifact', source: 'artifacts.committed' },
  { label: '平均镜头数', source: 'shots.average' },
]

const EMPTY_STATUS: ProjectStatusDistribution = {
  running: 0,
  failed: 0,
  succeeded: 0,
  idle: 0,
}

type StatsView = 'project' | 'api'

export function ProjectStatisticsPanel({
  metrics = EMPTY_METRICS,
  statusDistribution = EMPTY_STATUS,
  trendUnavailableLabel = '尚无历史快照可绘制',
  updatedLabel = '等待项目快照',
  apiUsage,
  className,
}: ProjectStatisticsPanelProps) {
  const [view, setView] = useState<StatsView>('project')
  const isProject = view === 'project'

  return (
    <section
      className={cn(
        'grid min-h-[350px] overflow-hidden rounded-lg border border-ds-border bg-ds-surface text-ds-text backdrop-blur-xl md:grid-cols-[176px_minmax(0,1fr)]',
        className,
      )}
    >
      <aside className="flex flex-col gap-1.5 border-b border-ds-border bg-ds-surface-muted p-3.5 md:border-b-0 md:border-r">
        <p className="text-[10px] font-semibold text-ds-text-muted">统计视图</p>
        <StatsTab
          active={isProject}
          icon={BarChart3}
          label="项目统计"
          onClick={() => setView('project')}
        />
        <StatsTab
          active={!isProject}
          icon={Activity}
          label="API 调用统计"
          onClick={() => setView('api')}
        />
        <div className="mt-auto hidden space-y-2 md:block">
          <div>
            <p className="font-mono text-[10px] font-semibold text-ds-text-muted">
              DATA SOURCE
            </p>
            <p className="mt-0.5 break-all font-mono text-[10px]">
              {isProject ? 'WorkspaceStatisticsSnapshotV1' : 'AiUsageProjectionV1'}
            </p>
          </div>
          <Link
            href={PLAYBOOK_HREF}
            className="inline-flex text-[10px] font-semibold text-ds-primary hover:underline"
          >
            在 Playbook 查看
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-2.5 p-3.5">
        {isProject ? (
          <ProjectStatisticsView
            metrics={metrics}
            statusDistribution={statusDistribution}
            trendUnavailableLabel={trendUnavailableLabel}
            updatedLabel={updatedLabel}
          />
        ) : (
          <ProjectStatisticsApiView initialProjection={apiUsage} />
        )}
        <div className="flex justify-end md:hidden">
          <Link
            href={PLAYBOOK_HREF}
            className="text-[10px] font-semibold text-ds-primary hover:underline"
          >
            在 Playbook 查看
          </Link>
        </div>
      </div>
    </section>
  )
}

function StatsTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof BarChart3
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-[34px] w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors',
        active
          ? 'bg-ds-blue-soft font-semibold text-ds-text'
          : 'text-ds-text-muted hover:bg-ds-surface hover:text-ds-text',
      )}
    >
      <Icon
        aria-hidden
        className={cn('size-4', active && 'text-ds-primary')}
      />
      {label}
    </button>
  )
}

function ProjectStatisticsView({
  metrics,
  statusDistribution,
  trendUnavailableLabel,
  updatedLabel,
}: {
  metrics: readonly ProjectMetric[]
  statusDistribution: ProjectStatusDistribution
  trendUnavailableLabel: string
  updatedLabel: string
}) {
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <h2 className="text-sm font-semibold">项目统计</h2>
          <p className="text-xs text-ds-text-muted">
            项目吞吐、执行状态与交付产物的持久快照。
          </p>
        </span>
        <span className="font-mono text-[10px] text-ds-text-muted">
          {updatedLabel}
        </span>
      </header>
      <div className="grid min-h-14 grid-cols-2 border-y border-ds-border lg:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.source}
            className="flex min-w-0 flex-col justify-center border-r border-ds-border px-2.5 py-2 last:border-r-0"
          >
            <span className="text-[10px] text-ds-text-muted">{metric.label}</span>
            <strong className="font-mono text-lg">{metric.value ?? '—'}</strong>
            <span className="truncate font-mono text-[10px] text-ds-text-muted">
              {metric.source}
            </span>
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <EmptyTrend label={trendUnavailableLabel} />
        <StatusDistribution distribution={statusDistribution} />
      </div>
    </>
  )
}

function EmptyTrend({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">项目完成趋势</h3>
        <p className="text-[10px] text-ds-text-muted">最近 7 天完成与发布的项目</p>
      </div>
      <div className="ds-dot-grid flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-ds-border px-4 py-6 text-center">
        <LineChart aria-hidden className="size-7 text-ds-text-muted" />
        <p className="text-sm font-semibold text-ds-text">{label}</p>
        <p className="max-w-xs text-xs leading-5 text-ds-text-muted">
          历史时间序列尚未接入；此处不展示估算曲线或假百分比。
        </p>
      </div>
    </div>
  )
}

const STATUS_ROWS: readonly [
  keyof ProjectStatusDistribution,
  string,
][] = [
  ['running', '运行中'],
  ['failed', '失败'],
  ['succeeded', '已完成'],
  ['idle', '待执行'],
]

function StatusDistribution({
  distribution,
}: {
  distribution: ProjectStatusDistribution
}) {
  return (
    <div className="flex min-h-40 flex-col rounded-md bg-ds-surface-muted p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">状态分布</h3>
        <span className="text-[10px] text-ds-text-muted">当前快照</span>
      </div>
      <div className="grid flex-1 content-center gap-2 py-3">
        {STATUS_ROWS.map(([key, label]) => (
          <div
            key={key}
            className="flex items-center justify-between border-b border-ds-border pb-1 text-xs last:border-b-0"
          >
            <span className="text-ds-text-muted">{label}</span>
            <strong className="font-mono text-ds-text">{distribution[key]}</strong>
          </div>
        ))}
      </div>
      <code className="text-[10px] text-ds-text-muted">pipeline.currentStatus</code>
    </div>
  )
}
