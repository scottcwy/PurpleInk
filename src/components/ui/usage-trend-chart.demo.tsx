import { UsageTrendChart, type UsageTrendPoint } from './usage-trend-chart'

const SERIES: UsageTrendPoint[] = [
  { date: '2026-07-24', managedCalls: 2, ownApiCalls: 1, cumulativePercent: 3 },
  { date: '2026-07-25', managedCalls: 0, ownApiCalls: 3, cumulativePercent: 3 },
  { date: '2026-07-26', managedCalls: 5, ownApiCalls: 2, cumulativePercent: 9 },
  { date: '2026-07-27', managedCalls: 3, ownApiCalls: 0, cumulativePercent: 13 },
  { date: '2026-07-28', managedCalls: 1, ownApiCalls: 4, cumulativePercent: 14 },
  { date: '2026-07-29', managedCalls: 4, ownApiCalls: 2, cumulativePercent: 19 },
  { date: '2026-07-30', managedCalls: 2, ownApiCalls: 2, cumulativePercent: 22 },
]

export function UsageTrendChartDemo() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-semibold">累计额度阶梯线</h3>
        <UsageTrendChart variant="cumulative-line" series={SERIES} />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">每日调用堆叠柱</h3>
        <UsageTrendChart variant="stacked-bars" series={SERIES} />
      </section>
    </div>
  )
}
