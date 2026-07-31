import { cn } from '@/lib/utils'

export interface UsageTrendPoint {
  date: string
  managedCalls: number
  ownApiCalls: number
  cumulativePercent: number | null
}

export interface UsageTrendChartProps {
  variant: 'cumulative-line' | 'stacked-bars'
  series: readonly UsageTrendPoint[]
  className?: string
}

export function UsageTrendChart({
  variant,
  series,
  className,
}: UsageTrendChartProps) {
  return (
    <figure className={cn('min-w-0', className)}>
      {variant === 'cumulative-line'
        ? <CumulativeLine series={series} />
        : <StackedBars series={series} />}
      <AccessibleDataTable variant={variant} series={series} />
    </figure>
  )
}

function CumulativeLine({ series }: { series: readonly UsageTrendPoint[] }) {
  const width = 720
  const height = 190
  const plot = { left: 34, top: 14, right: 16, bottom: 30 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const x = (index: number) =>
    plot.left + (series.length <= 1 ? 0 : index * plotWidth / (series.length - 1))
  const y = (percent: number) =>
    plot.top + plotHeight * (1 - Math.min(100, Math.max(0, percent)) / 100)
  const path = series.reduce((value, point, index) => {
    const nextX = x(index)
    const nextY = y(point.cumulativePercent ?? 0)
    if (index === 0) return `M ${nextX} ${nextY}`
    return `${value} H ${nextX} V ${nextY}`
  }, '')

  return (
    <div className="overflow-x-auto rounded-md border border-ds-border bg-ds-surface-muted/40 p-2">
      {/* <640px 按 viewBox 等比缩放到容器宽，保证整条曲线可见；sm 起维持 620px 底宽（超出可横滑）。 */}
      <svg
        className="h-auto w-full sm:min-w-[620px]"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="当前会员周期累计额度消耗百分比阶梯折线图"
      >
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={width - plot.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--ds-border)"
              strokeDasharray={tick === 100 ? '5 4' : undefined}
            />
            <text
              x={plot.left - 6}
              y={y(tick) + 3}
              textAnchor="end"
              fill="var(--ds-text-muted)"
              fontSize="9"
            >
              {tick}%
            </text>
          </g>
        ))}
        <path
          d={path}
          fill="none"
          stroke="var(--ds-blue)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {series.map((point, index) => {
          const percent = point.cumulativePercent ?? 0
          const noCalls = point.managedCalls === 0
          const label = `${formatDate(point.date)}，累计已用 ${percent}%，${
            noCalls ? '无新托管调用' : `${point.managedCalls} 次托管调用`
          }`
          return (
            <circle
              key={point.date}
              cx={x(index)}
              cy={y(percent)}
              r={noCalls ? 2.5 : 3.5}
              fill={noCalls ? 'var(--ds-surface)' : 'var(--ds-blue)'}
              stroke="var(--ds-blue)"
              strokeWidth="1.5"
              tabIndex={0}
              aria-label={label}
            >
              <title>{label}</title>
            </circle>
          )
        })}
        <text
          x={width - plot.right}
          y={height - 8}
          textAnchor="end"
          fill="var(--ds-text-muted)"
          fontSize="9"
        >
          周期进行中 · 终点为周期结束日
        </text>
      </svg>
    </div>
  )
}

function StackedBars({ series }: { series: readonly UsageTrendPoint[] }) {
  const max = Math.max(
    1,
    ...series.map((point) => point.managedCalls + point.ownApiCalls),
  )
  return (
    <div
      className="flex min-h-44 items-end gap-2 overflow-x-auto rounded-md border border-ds-border bg-ds-surface-muted/40 px-3 pb-3 pt-5"
      role="img"
      aria-label="每日 AI 实际调用堆叠柱图，按平台托管与自己的 API 分组"
    >
      {series.map((point) => {
        const total = point.managedCalls + point.ownApiCalls
        const height = Math.max(total === 0 ? 2 : 14, total * 116 / max)
        const managedHeight = total === 0 ? 0 : point.managedCalls * height / total
        const ownHeight = total === 0 ? 0 : point.ownApiCalls * height / total
        const label = `${formatDate(point.date)}，共 ${total} 次；平台托管 ${
          point.managedCalls
        } 次，自己的 API ${point.ownApiCalls} 次`
        return (
          <div
            key={point.date}
            className="flex min-w-10 flex-1 flex-col items-center justify-end gap-1.5"
          >
            <button
              type="button"
              className="flex w-full max-w-12 flex-col justify-end overflow-hidden rounded-sm border border-ds-border bg-ds-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring"
              style={{ height }}
              aria-label={label}
              title={label}
            >
              {point.ownApiCalls > 0 && (
                <span
                  aria-hidden
                  className="w-full bg-ds-text-muted/45"
                  style={{ height: ownHeight }}
                />
              )}
              {point.managedCalls > 0 && (
                <span
                  aria-hidden
                  className="w-full bg-ds-blue"
                  style={{ height: managedHeight }}
                />
              )}
            </button>
            <span className="font-mono text-[9px] text-ds-text-muted">
              {point.date.slice(5).replace('-', '/')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function AccessibleDataTable({
  variant,
  series,
}: {
  variant: UsageTrendChartProps['variant']
  series: readonly UsageTrendPoint[]
}) {
  return (
    <details className="mt-2 text-xs text-ds-text-muted">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring">
        查看图表数值表
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-ds-border">
              <th className="p-2 font-semibold">日期</th>
              {variant === 'cumulative-line' ? (
                <th className="p-2 font-semibold">累计额度</th>
              ) : (
                <>
                  <th className="p-2 font-semibold">平台托管</th>
                  <th className="p-2 font-semibold">自己的 API</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.date} className="border-b border-ds-border/70">
                <td className="p-2 font-mono">{point.date}</td>
                {variant === 'cumulative-line' ? (
                  <td className="p-2 font-mono">{point.cumulativePercent ?? 0}%</td>
                ) : (
                  <>
                    <td className="p-2 font-mono">{point.managedCalls}</td>
                    <td className="p-2 font-mono">{point.ownApiCalls}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function formatDate(value: string): string {
  return value.replaceAll('-', '/')
}
