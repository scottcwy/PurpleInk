import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ApiDemoMetric {
  label: string
  value: string
  source: string
}

/** Playbook / 工作台 API 视图共用的标注演示数据，不得解释为生产计量。 */
export const API_DEMO_METRICS: readonly ApiDemoMetric[] = [
  { label: '今日请求', value: '1,284', source: 'demo.requests.today' },
  { label: '成功率', value: '98.6%', source: 'demo.requests.successRate' },
  { label: 'P95 延迟', value: '420ms', source: 'demo.latency.p95' },
  { label: '配额余量', value: '72%', source: 'demo.quota.remaining' },
]

export const API_DEMO_BREAKDOWN: readonly {
  label: string
  value: string
  percent: number
}[] = [
  { label: 'LLM 补全', value: '612', percent: 48 },
  { label: 'TTS 合成', value: '318', percent: 25 },
  { label: 'Artifact 读写', value: '214', percent: 17 },
  { label: '其他', value: '140', percent: 10 },
]

export function ProjectStatisticsApiView({ className }: { className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2.5', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <h2 className="text-sm font-semibold">API 调用统计</h2>
          <p className="text-xs text-ds-text-muted">
            演示用量分布，用于视觉验收，不代表真实计量。
          </p>
        </span>
        <span className="rounded-full border border-ds-border bg-ds-surface-muted px-2.5 py-1 text-[10px] font-semibold text-ds-text-muted">
          演示数据 · 非生产计量
        </span>
      </header>

      <div className="grid min-h-14 grid-cols-2 border-y border-ds-border lg:grid-cols-4">
        {API_DEMO_METRICS.map((metric) => (
          <div
            key={metric.source}
            className="flex min-w-0 flex-col justify-center border-r border-ds-border px-2.5 py-2 last:border-r-0"
          >
            <span className="text-[10px] text-ds-text-muted">{metric.label}</span>
            <strong className="font-mono text-lg">{metric.value}</strong>
            <span className="truncate font-mono text-[10px] text-ds-text-muted">
              {metric.source}
            </span>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-h-40 flex-col gap-2">
          <div>
            <h3 className="text-sm font-semibold">调用构成</h3>
            <p className="text-[10px] text-ds-text-muted">演示日分布（相对占比）</p>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-3 rounded-md border border-ds-border bg-ds-surface-muted/40 p-3">
            {API_DEMO_BREAKDOWN.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-ds-text-muted">{row.label}</span>
                  <span className="font-mono text-ds-text">
                    {row.value}
                    <span className="text-ds-text-muted"> · {row.percent}%</span>
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-ds-border"
                  role="presentation"
                >
                  <div
                    className="h-full rounded-full bg-ds-primary/70"
                    style={{ width: `${row.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-40 flex-col rounded-md bg-ds-surface-muted p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">说明</h3>
            <Activity aria-hidden className="size-3.5 text-ds-text-muted" />
          </div>
          <p className="mt-3 text-xs leading-5 text-ds-text-muted">
            本视图为 PlaybookFixture，仅用于组件登记与版式验收。生产环境不会据此计费或限流。
          </p>
          <code className="mt-auto pt-3 text-[10px] text-ds-text-muted">
            source: PlaybookFixture
          </code>
        </div>
      </div>
    </div>
  )
}
