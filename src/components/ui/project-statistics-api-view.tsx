'use client'

import { Activity, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import {
  type AiUsageProjectionV1,
  type AiUsageRange,
  useAiUsageProjection,
} from '@/features/usage/client'
import { cn } from '@/lib/utils'
import { UsageTrendChart } from './usage-trend-chart'

export function ProjectStatisticsApiView({
  initialProjection,
  className,
}: {
  initialProjection: AiUsageProjectionV1 | null
  className?: string
}) {
  const [range, setRange] = useState<Extract<AiUsageRange, '7d' | '30d'>>('7d')
  const state = useAiUsageProjection(initialProjection, 'account', range)
  const projection = state.projection?.range === range
    ? state.projection
    : null

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <h2 className="text-sm font-semibold">AI 调用统计</h2>
          <p className="text-xs text-ds-text-muted">
            当前账号跨工作区发起的全部真实 AI 请求。
          </p>
        </span>
        <div className="flex items-center gap-1 rounded-md border border-ds-border p-1">
          {(['7d', '30d'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring',
                range === value
                  ? 'bg-ds-blue-soft font-semibold text-ds-text'
                  : 'text-ds-text-muted hover:bg-ds-surface-muted hover:text-ds-text',
              )}
            >
              {value === '7d' ? '近 7 天' : '近 30 天'}
            </button>
          ))}
        </div>
      </header>

      {state.status === 'error' && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-ds-red/35 bg-ds-red-soft p-3 text-xs text-ds-text"
        >
          <AlertCircle aria-hidden className="size-4 shrink-0 text-ds-red" />
          真实统计接口暂不可用；未使用演示数字回退。
        </div>
      )}

      {projection ? (
        <UsageContent projection={projection} loading={state.status === 'loading'} />
      ) : (
        <EmptyUsageState loading={state.status === 'loading'} />
      )}
    </div>
  )
}

function UsageContent({
  projection,
  loading,
}: {
  projection: AiUsageProjectionV1
  loading: boolean
}) {
  const summary = projection.summary
  const metrics = [
    { label: '实际调用', value: format(summary.actualCalls), source: 'provider started' },
    {
      label: '成功率',
      value: summary.successRate === null ? '—' : `${summary.successRate}%`,
      source: 'terminal calls',
    },
    {
      label: '已报告 Token',
      value: format(summary.reportedTokens.total),
      source: 'reported usage',
    },
    {
      label: 'P95',
      value: summary.p95DurationMs === null
        ? '样本不足'
        : `${format(summary.p95DurationMs)}ms`,
      source: 'provider duration',
    },
  ]
  const partial = !projection.coverage.attributionComplete
    || projection.coverage.byokHistoryMissing

  return (
    <>
      <div className="grid min-h-16 grid-cols-2 border-y border-ds-border lg:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex min-w-0 flex-col justify-center border-r border-ds-border px-2.5 py-2 last:border-r-0"
          >
            <span className="text-xs text-ds-text-muted">{metric.label}</span>
            <strong className="font-mono text-lg">{metric.value}</strong>
            <span className="truncate font-mono text-[10px] text-ds-text-muted">
              {metric.source}
            </span>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_230px]">
        <section aria-labelledby="account-usage-trend">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="account-usage-trend" className="text-sm font-semibold">
                每日实际调用
              </h3>
              <p className="text-xs text-ds-text-muted">
                平台托管与自己的 API 分开堆叠，不混合 Token、字符和音频秒数。
              </p>
            </div>
            <Legend />
          </div>
          {summary.actualCalls === 0 ? (
            <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-ds-border text-sm text-ds-text-muted">
              这个时间范围内还没有真实出网调用
            </div>
          ) : (
            <UsageTrendChart variant="stacked-bars" series={projection.series} />
          )}
        </section>
        <aside className="space-y-4 rounded-md bg-ds-surface-muted p-3">
          <Breakdown title="能力构成" rows={projection.breakdown.capability} />
          <Breakdown title="供应商构成" rows={projection.breakdown.provider} />
          <div className="border-t border-ds-border pt-3 text-xs leading-5 text-ds-text-muted">
            <p>
              TTS 字符 {format(summary.ttsCharacters)} · ASR 音频{' '}
              {summary.asrAudioSeconds.toFixed(1)} 秒
            </p>
            <p>usage 未报告 {format(projection.usageUnavailableCount)} 次</p>
          </div>
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ds-text-muted">
        <Activity aria-hidden className="size-3.5" />
        <span>
          {partial
            ? `部分完整：账号精确归属从 ${formatDateTime(
                projection.coverage.completeFrom,
                projection.timeZone,
              )} 起`
            : '当前范围账号归属完整'}
        </span>
        {loading && <span>· 正在按本地时区刷新</span>}
        <code className="ml-auto">AiUsageProjectionV1</code>
      </div>
    </>
  )
}

function Breakdown({
  title,
  rows,
}: {
  title: string
  rows: AiUsageProjectionV1['breakdown']['provider']
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-ds-text-muted">暂无数据</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.slice(0, 5).map((row) => (
            <li key={row.key}>
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate text-ds-text-muted">{row.label}</span>
                <span className="font-mono">{row.calls} · {row.percent}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-ds-border">
                <div
                  className="h-full bg-ds-blue"
                  style={{ width: `${row.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Legend() {
  return (
    <p className="flex gap-3 text-xs text-ds-text-muted" aria-label="图例">
      <span className="inline-flex items-center gap-1">
        <i aria-hidden className="size-2 rounded-sm bg-ds-blue" />平台托管
      </span>
      <span className="inline-flex items-center gap-1">
        <i aria-hidden className="size-2 rounded-sm bg-ds-text-muted/45" />自己的 API
      </span>
    </p>
  )
}

function EmptyUsageState({ loading }: { loading: boolean }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-ds-border px-5 text-center">
      <Activity aria-hidden className="size-5 text-ds-text-muted" />
      <h3 className="mt-3 text-sm font-semibold">
        {loading ? '正在读取真实调用账本' : '真实统计暂不可用'}
      </h3>
      <p className="mt-1 max-w-md text-xs leading-5 text-ds-text-muted">
        此处不会回退到 Playbook fixture 或硬编码指标。
      </p>
    </div>
  )
}

function format(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(value))
}
