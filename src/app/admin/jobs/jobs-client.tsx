'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill'

/**
 * 任务监控客户端：状态筛选 + 分页列表，点击行展开详情（阶段时间线由相邻
 * 日志时间差推导 + 原始日志）。数据是 worker 落影的 render_jobs 只读镜像，
 * 允许秒级滞后，手动刷新即可（无自动轮询——轮询留给 /admin/ops）。
 */

interface RenderJobListItem {
  id: string
  kind: string
  input: string
  status: string
  phase: string
  error: string | null
  elapsedSec: number | null
  durationSec: number | null
  checkPassed: boolean | null
  goldenVerified: boolean | null
  createdAt: string
  updatedAt: string
}

interface JobListData {
  jobs: RenderJobListItem[]
  total: number
  page: number
  pageSize: number
  summary: {
    today: number
    successRate: number | null
    avgDurationSec: number | null
  }
}

interface RenderJobLogEntry {
  at: number
  msg: string
}

const PAGE_SIZE = 20

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '运行中' },
  { value: 'done', label: '已完成' },
  { value: 'failed', label: '失败' },
]

const STATUS_PILLS: Record<string, { variant: StatusPillVariant; label: string }> = {
  queued: { variant: 'pending', label: '排队中' },
  running: { variant: 'generating', label: '运行中' },
  done: { variant: 'rendered', label: '已完成' },
  failed: { variant: 'failed', label: '失败' },
}

export function JobsClient() {
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<JobListData | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (status !== 'all') params.set('status', status)
      const response = await fetch(`/api/admin/jobs?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setData((await response.json()) as JobListData & { ok: true })
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1
  const summary = data?.summary

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">任务监控</h1>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={STATUS_FILTERS}
            value={status}
            onChange={(next) => {
              setPage(1)
              setExpandedId(null)
              setStatus(next)
            }}
          />
          <Button variant="gray" size="md" icon={RefreshCw} onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="text-[13px] text-ds-text-muted">今日任务</div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums">{summary?.today ?? '—'}</div>
        </Card>
        <Card>
          <div className="text-[13px] text-ds-text-muted">今日成功率</div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums">
            {summary?.successRate === null || summary === undefined
              ? '—'
              : `${Math.round(summary.successRate * 100)}%`}
          </div>
        </Card>
        <Card>
          <div className="text-[13px] text-ds-text-muted">平均视频时长</div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums">
            {summary?.avgDurationSec === null || summary === undefined
              ? '—'
              : `${Math.round(summary.avgDurationSec)}s`}
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
              <th className="px-5 py-3 font-medium">任务</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 font-medium">阶段</th>
              <th className="px-3 py-3 font-medium">耗时</th>
              <th className="px-3 py-3 font-medium">校验</th>
              <th className="px-5 py-3 font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {(data?.jobs ?? []).map((job) => {
              const pill = STATUS_PILLS[job.status] ?? { variant: 'pending' as const, label: job.status }
              const expanded = expandedId === job.id
              return (
                <JobRow
                  key={job.id}
                  job={job}
                  pill={pill}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : job.id)}
                />
              )
            })}
            {!loading && (data?.jobs.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ds-text-muted">
                  {listError ? `加载失败：${listError}` : '暂无任务'}
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ds-text-muted">
                  加载中…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-[13px] text-ds-text-muted">
        <span>共 {data?.total ?? 0} 个任务</span>
        <div className="flex items-center gap-2">
          <Button
            variant="gray"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(current - 1, 1))}
          >
            上一页
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="gray"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  )
}

function JobRow({
  job,
  pill,
  expanded,
  onToggle,
}: {
  job: RenderJobListItem
  pill: { variant: StatusPillVariant; label: string }
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-ds-border/60 transition-colors last:border-b-0 hover:bg-ds-surface-muted/50"
        onClick={onToggle}
      >
        <td className="max-w-[280px] px-5 py-3">
          <div className="truncate font-medium" title={job.input}>
            {job.input || '（无输入）'}
          </div>
          <div className="mt-0.5 text-[11px] text-ds-text-muted">
            {job.kind} · {job.id.slice(0, 8)}
          </div>
        </td>
        <td className="px-3 py-3">
          <StatusPill variant={pill.variant} label={pill.label} />
        </td>
        <td className="px-3 py-3 text-ds-text-muted">{job.phase}</td>
        <td className="px-3 py-3 tabular-nums text-ds-text-muted">
          {job.elapsedSec === null ? '—' : `${Math.round(job.elapsedSec)}s`}
        </td>
        <td className="px-3 py-3">
          <VerifyBadges checkPassed={job.checkPassed} goldenVerified={job.goldenVerified} />
        </td>
        <td className="px-5 py-3 text-ds-text-muted">{formatTime(job.createdAt)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-ds-border/60 last:border-b-0">
          <td colSpan={6} className="bg-ds-surface-muted/40 px-5 py-4">
            <JobDetail jobId={job.id} fallbackError={job.error} />
          </td>
        </tr>
      )}
    </>
  )
}

function VerifyBadges({
  checkPassed,
  goldenVerified,
}: {
  checkPassed: boolean | null
  goldenVerified: boolean | null
}) {
  if (checkPassed === null && goldenVerified === null) {
    return <span className="text-ds-text-muted">—</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {checkPassed !== null && (
        <StatusPill
          variant={checkPassed ? 'rendered' : 'failed'}
          label={checkPassed ? 'check 通过' : 'check 未过'}
        />
      )}
      {goldenVerified !== null && (
        <StatusPill
          variant={goldenVerified ? 'rendered' : 'failed'}
          label={goldenVerified ? 'golden 通过' : 'golden 未过'}
        />
      )}
    </div>
  )
}

interface JobDetailData extends RenderJobListItem {
  logs: RenderJobLogEntry[]
}

function JobDetail({ jobId, fallbackError }: { jobId: string; fallbackError: string | null }) {
  const [detail, setDetail] = useState<JobDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/jobs/${jobId}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = (await response.json()) as { ok: true; job: JobDetailData }
        if (!cancelled) setDetail(body.job)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  if (error) return <p className="text-[13px] text-ds-red">详情加载失败：{error}</p>
  if (!detail) return <p className="text-[13px] text-ds-text-muted">详情加载中…</p>

  const jobError = detail.error ?? fallbackError

  return (
    <div className="flex flex-col gap-4">
      {jobError && (
        <p className="rounded-md bg-ds-red-soft px-3 py-2 text-[13px] text-ds-red">{jobError}</p>
      )}
      <div>
        <div className="mb-2 text-[12px] font-medium text-ds-text-muted">阶段时间线</div>
        <PhaseTimeline logs={detail.logs} />
      </div>
      <div>
        <div className="mb-2 text-[12px] font-medium text-ds-text-muted">原始日志</div>
        <pre className="max-h-64 overflow-auto rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-[12px] leading-relaxed text-ds-text-muted">
          {detail.logs.length === 0
            ? '（暂无日志）'
            : detail.logs.map((entry) => `${formatClock(entry.at)}  ${entry.msg}`).join('\n')}
        </pre>
      </div>
    </div>
  )
}

/** 阶段耗时 = 相邻日志时间差；最后一条无后继，不标时长。 */
function PhaseTimeline({ logs }: { logs: RenderJobLogEntry[] }) {
  if (logs.length === 0) {
    return <p className="text-[13px] text-ds-text-muted">（暂无阶段记录）</p>
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {logs.map((entry, index) => {
        const next = logs[index + 1]
        const durationMs = next ? next.at - entry.at : null
        return (
          <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-[13px]">
            <span className="w-16 shrink-0 tabular-nums text-ds-text-muted">
              {formatClock(entry.at)}
            </span>
            <span className="min-w-0 flex-1 truncate" title={entry.msg}>
              {entry.msg}
            </span>
            <span className="shrink-0 tabular-nums text-ds-text-muted">
              {durationMs === null ? '' : formatDuration(durationMs)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

function formatClock(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
