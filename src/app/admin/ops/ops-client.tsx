'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'

/**
 * 系统运维客户端：DB/worker 健康、队列深度、供应商 RPM/TPM 占用与冷却。
 * 每 10 秒轮询 /api/admin/ops（计划 §5）；页面隐藏时暂停，避免后台标签页
 * 空转打点。
 */

interface OpsSnapshot {
  db: { ok: boolean; latencyMs: number | null; error?: string }
  worker: { ok: boolean; jobs: number | null; error?: string }
  queue: { queued: number; running: number; failedRecent: number }
  providers: { provider: string; funding: string; rpm: number; tpm: number; active: number }[]
  cooldowns: { provider: string; blockedUntil: string }[]
}

const POLL_INTERVAL_MS = 10_000

export function OpsClient() {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await fetch('/api/admin/ops', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSnapshot((await response.json()) as OpsSnapshot & { ok: true })
      setUpdatedAt(new Date())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">系统运维</h1>
        <div className="flex items-center gap-3 text-[12px] text-ds-text-muted">
          {updatedAt && <span>更新于 {formatClock(updatedAt)} · 每 10 秒自动刷新</span>}
          <Button variant="gray" size="sm" icon={RefreshCw} onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-ds-red-soft px-3 py-2 text-[13px] text-ds-red">
          快照拉取失败：{error}
        </p>
      )}

      {!snapshot && !error && <p className="text-[13px] text-ds-text-muted">加载中…</p>}

      {snapshot && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Card>
              <div className="text-[13px] text-ds-text-muted">数据库</div>
              <div className="mt-2">
                <StatusPill
                  variant={snapshot.db.ok ? 'rendered' : 'failed'}
                  label={snapshot.db.ok ? `正常 ${snapshot.db.latencyMs}ms` : '异常'}
                />
              </div>
              {snapshot.db.error && (
                <div className="mt-1.5 truncate text-[11px] text-ds-red" title={snapshot.db.error}>
                  {snapshot.db.error}
                </div>
              )}
            </Card>
            <Card>
              <div className="text-[13px] text-ds-text-muted">Worker</div>
              <div className="mt-2">
                <StatusPill
                  variant={snapshot.worker.ok ? 'rendered' : 'failed'}
                  label={
                    snapshot.worker.ok
                      ? `正常${snapshot.worker.jobs === null ? '' : ` · ${snapshot.worker.jobs} 任务`}`
                      : '异常'
                  }
                />
              </div>
              {snapshot.worker.error && (
                <div
                  className="mt-1.5 truncate text-[11px] text-ds-red"
                  title={snapshot.worker.error}
                >
                  {snapshot.worker.error}
                </div>
              )}
            </Card>
            <Card>
              <div className="text-[13px] text-ds-text-muted">队列排队</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums">
                {snapshot.queue.queued}
              </div>
            </Card>
            <Card>
              <div className="text-[13px] text-ds-text-muted">运行中</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums">
                {snapshot.queue.running}
              </div>
            </Card>
            <Card>
              <div className="text-[13px] text-ds-text-muted">近 30 分钟失败</div>
              <div className="mt-1.5 text-2xl font-semibold tabular-nums">
                {snapshot.queue.failedRecent}
              </div>
            </Card>
          </div>

          <Card className="p-0">
            <div className="px-5 pb-1 pt-5">
              <CardTitle>供应商占用（滚动 60 秒）</CardTitle>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
                  <th className="px-5 py-3 font-medium">供应商</th>
                  <th className="px-3 py-3 font-medium">资金池</th>
                  <th className="px-3 py-3 font-medium">RPM 占用</th>
                  <th className="px-3 py-3 font-medium">TPM 占用</th>
                  <th className="px-5 py-3 font-medium">在途并发</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.providers.map((row) => (
                  <tr
                    key={`${row.provider}:${row.funding}`}
                    className="border-b border-ds-border/60 last:border-b-0"
                  >
                    <td className="px-5 py-3 font-medium">{row.provider}</td>
                    <td className="px-3 py-3 text-ds-text-muted">{row.funding}</td>
                    <td className="px-3 py-3 tabular-nums">{row.rpm}</td>
                    <td className="px-3 py-3 tabular-nums">{row.tpm}</td>
                    <td className="px-5 py-3 tabular-nums">{row.active}</td>
                  </tr>
                ))}
                {snapshot.providers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-ds-text-muted">
                      窗口内没有供应商调用
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardTitle>供应商冷却</CardTitle>
            <div className="mt-3">
              {snapshot.cooldowns.length === 0 ? (
                <p className="text-[13px] text-ds-text-muted">当前没有处于冷却期的供应商</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {snapshot.cooldowns.map((row) => (
                    <li key={row.provider} className="flex items-center gap-2 text-[13px]">
                      <StatusPill variant="stale" label={row.provider} />
                      <span className="text-ds-text-muted">
                        冷却至 {formatClock(new Date(row.blockedUntil))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

function formatClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
