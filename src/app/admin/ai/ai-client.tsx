'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'

/**
 * AI 调用审计客户端：调用量 SVG 柱状图（复用概览页 DauBarChart 模式）+ 总调用 /
 * 成功率 / 成本卡 + 失败分布与 top models 表。窗口可切换 7/30/90 天。
 */

interface AiDailyPoint {
  date: string
  total: number
  succeeded: number
  failed: number
}

interface AiFailurePoint {
  failureKind: string
  count: number
}

interface AiModelPoint {
  provider: string
  model: string
  count: number
  avgDurationMs: number | null
}

interface AiAuditMetrics {
  windowDays: number
  totalInvocations: number
  succeeded: number
  failed: number
  successRate: number | null
  totalCostCny: number
  days: AiDailyPoint[]
  failures: AiFailurePoint[]
  topModels: AiModelPoint[]
}

const WINDOW_OPTIONS = [
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
]

export function AiClient() {
  const [days, setDays] = useState('30')
  const [metrics, setMetrics] = useState<AiAuditMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/ai?days=${days}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setMetrics((await response.json()) as AiAuditMetrics & { ok: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const stats = metrics
    ? [
        { label: '总调用', value: String(metrics.totalInvocations), hint: `成功 ${metrics.succeeded} · 失败 ${metrics.failed}` },
        {
          label: '成功率',
          value: metrics.successRate === null ? '—' : `${Math.round(metrics.successRate * 100)}%`,
          hint: metrics.successRate === null ? '窗口内无落定调用' : '已落定调用占比',
        },
        { label: '成本合计', value: `¥${metrics.totalCostCny.toFixed(2)}`, hint: '已结算 settled 求和' },
      ]
    : []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">AI 调用审计</h1>
        <div className="flex items-center gap-3">
          <SegmentedControl options={WINDOW_OPTIONS} value={days} onChange={setDays} />
          <Button variant="gray" size="md" icon={RefreshCw} onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-ds-red-soft px-3 py-2 text-[13px] text-ds-red">
          数据拉取失败：{error}
        </p>
      )}

      {!metrics && !error && <p className="text-[13px] text-ds-text-muted">加载中…</p>}

      {metrics && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {stats.map((stat) => (
              <Card key={stat.label}>
                <div className="text-[13px] text-ds-text-muted">{stat.label}</div>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums">{stat.value}</div>
                <div className="mt-1 text-[12px] text-ds-text-muted">{stat.hint}</div>
              </Card>
            ))}
          </div>

          <Card>
            <div className="flex items-baseline justify-between">
              <CardTitle>近 {metrics.windowDays} 天调用量</CardTitle>
              <span className="text-[12px] text-ds-text-muted">按状态分堆（成功 / 失败）</span>
            </div>
            <CardBody>
              <InvocationBarChart days={metrics.days} />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-0">
              <div className="px-5 pb-1 pt-5">
                <CardTitle>失败分布</CardTitle>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
                    <th className="px-5 py-3 font-medium">失败类型</th>
                    <th className="px-5 py-3 text-right font-medium">次数</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.failures.map((row) => (
                    <tr
                      key={row.failureKind}
                      className="border-b border-ds-border/60 last:border-b-0"
                    >
                      <td className="px-5 py-3 font-mono text-[13px]">{row.failureKind}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{row.count}</td>
                    </tr>
                  ))}
                  {metrics.failures.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-5 py-8 text-center text-ds-text-muted">
                        窗口内无失败调用
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>

            <Card className="p-0">
              <div className="px-5 pb-1 pt-5">
                <CardTitle>Top 模型</CardTitle>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
                    <th className="px-5 py-3 font-medium">模型</th>
                    <th className="px-3 py-3 text-right font-medium">调用</th>
                    <th className="px-5 py-3 text-right font-medium">平均耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topModels.map((row) => (
                    <tr
                      key={`${row.provider}/${row.model}`}
                      className="border-b border-ds-border/60 last:border-b-0"
                    >
                      <td className="px-5 py-3">
                        <div className="font-medium">{row.model}</div>
                        <div className="text-[12px] text-ds-text-muted">{row.provider}</div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.count}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {row.avgDurationMs === null ? '—' : `${Math.round(row.avgDurationMs)}ms`}
                      </td>
                    </tr>
                  ))}
                  {metrics.topModels.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-5 py-8 text-center text-ds-text-muted">
                        窗口内无调用记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      {loading && metrics && (
        <p className="text-[12px] text-ds-text-muted">刷新中…</p>
      )}
    </div>
  )
}

/**
 * 自绘 SVG 堆叠柱状图（同概览页取舍：不引第三方库）。viewBox 归一化到 100x36，
 * 每天一根柱，成功段在下、失败段在上；数值靠 <title> 悬浮提示。
 */
function InvocationBarChart({ days }: { days: AiDailyPoint[] }) {
  if (days.length === 0) {
    return <div className="py-8 text-center text-[13px]">暂无数据</div>
  }
  const max = Math.max(...days.map((day) => day.total), 1)
  const gap = 0.6
  const barWidth = 100 / days.length - gap
  const chartHeight = 36
  return (
    <div>
      <svg
        viewBox={`0 0 100 ${chartHeight}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`近 ${days.length} 天 AI 调用量柱状图`}
      >
        {days.map((day, index) => {
          const totalHeight = day.total === 0 ? 0 : Math.max((day.total / max) * chartHeight, 0.75)
          const failedHeight = day.total === 0 ? 0 : (day.failed / max) * chartHeight
          const succeededHeight = Math.max(totalHeight - failedHeight, 0)
          const x = index * (barWidth + gap)
          return (
            <g key={day.date}>
              <rect
                x={x}
                y={chartHeight - succeededHeight}
                width={barWidth}
                height={succeededHeight}
                rx={0.5}
                className="fill-ds-blue/70 hover:fill-ds-blue"
              >
                <title>{`${day.date} · 总 ${day.total} · 成功 ${day.succeeded} · 失败 ${day.failed}`}</title>
              </rect>
              {failedHeight > 0 && (
                <rect
                  x={x}
                  y={chartHeight - totalHeight}
                  width={barWidth}
                  height={failedHeight}
                  rx={0.5}
                  className="fill-ds-red/70 hover:fill-ds-red"
                >
                  <title>{`${day.date} · 失败 ${day.failed}`}</title>
                </rect>
              )}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-ds-text-muted">
        <span>{days[0]!.date}</span>
        <span>{days.at(-1)!.date}</span>
      </div>
    </div>
  )
}
