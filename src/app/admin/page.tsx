import { requireAdminSession } from '@/features/auth/page-session'
import { getDauMetrics } from '@/features/admin/metrics'
import { getOpsSnapshot } from '@/features/admin/ops'
import { listRenderJobs } from '@/features/admin/render-jobs-admin'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'

/**
 * 管理后台概览（服务端组件）：layout 守卫不传播到 children（RSC 独立渲染），
 * 这里自己再包 requireAdminSession，然后直接调 service——不绕 /api/admin/*。
 */
export const dynamic = 'force-dynamic'

const DAU_WINDOW_DAYS = 30

export default async function AdminOverviewPage() {
  await requireAdminSession('/admin')
  const [dau, ops, jobs] = await Promise.all([
    getDauMetrics(DAU_WINDOW_DAYS),
    getOpsSnapshot(),
    listRenderJobs({ page: 1, pageSize: 1 }),
  ])

  const stats = [
    { label: '总用户', value: String(dau.totalUsers), hint: `MAU ${dau.mau}` },
    { label: '今日活跃', value: String(dau.dauToday), hint: `WAU ${dau.wau}` },
    { label: '今日任务', value: String(jobs.summary.today), hint: `队列 ${ops.queue.queued} / 运行 ${ops.queue.running}` },
    {
      label: '今日成功率',
      value: jobs.summary.successRate === null ? '—' : `${Math.round(jobs.summary.successRate * 100)}%`,
      hint:
        jobs.summary.avgDurationSec === null
          ? '今日暂无落定任务'
          : `平均时长 ${Math.round(jobs.summary.avgDurationSec)}s`,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">概览</h1>
        <div className="flex items-center gap-2">
          <StatusPill
            variant={ops.db.ok ? 'rendered' : 'failed'}
            label={ops.db.ok ? `DB 正常 ${ops.db.latencyMs}ms` : 'DB 异常'}
          />
          <StatusPill
            variant={ops.worker.ok ? 'rendered' : 'failed'}
            label={ops.worker.ok ? `Worker 正常${ops.worker.jobs === null ? '' : ` · ${ops.worker.jobs} 任务`}` : 'Worker 异常'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          <CardTitle>近 {DAU_WINDOW_DAYS} 天活跃</CardTitle>
          <span className="text-[12px] text-ds-text-muted">DAU（去重会话活跃用户）</span>
        </div>
        <CardBody>
          <DauBarChart days={dau.days} />
        </CardBody>
      </Card>
    </div>
  )
}

/**
 * 自绘 SVG 柱状图（计划 §5：不引第三方图表库）。viewBox 归一化到 100x36，
 * 柱高按窗口内最大 DAU 线性缩放；具体数值靠 <title> 悬浮提示。
 */
function DauBarChart({ days }: { days: { date: string; dau: number; newUsers: number }[] }) {
  if (days.length === 0) {
    return <div className="py-8 text-center text-[13px]">暂无数据</div>
  }
  const max = Math.max(...days.map((day) => day.dau), 1)
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
        aria-label={`近 ${days.length} 天 DAU 柱状图`}
      >
        {days.map((day, index) => {
          // 有值时至少 0.75 高度，避免小值完全不可见。
          const height = day.dau === 0 ? 0 : Math.max((day.dau / max) * chartHeight, 0.75)
          return (
            <rect
              key={day.date}
              x={index * (barWidth + gap)}
              y={chartHeight - height}
              width={barWidth}
              height={height}
              rx={0.5}
              className="fill-ds-blue/70 hover:fill-ds-blue"
            >
              <title>{`${day.date} · DAU ${day.dau} · 新增 ${day.newUsers}`}</title>
            </rect>
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
