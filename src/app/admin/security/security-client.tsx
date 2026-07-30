'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status-pill'

/**
 * 安全监控客户端：接口访问统计 + 限流/攻击信号。每 10 秒轮询
 * /api/admin/security；页面隐藏时暂停（同 ops）。异常项用 StatusPill 高亮。
 */

interface RouteAccessStat {
  routeGroup: string
  total: number
  ok: number
  clientError: number
  unauthorized: number
  notFound: number
  serverError: number
  errorRate: number
}

interface ThrottleSignal {
  rule: string
  label: string
  limit: number
  windowMs: number
  activeKeys: number
  atOrOverLimit: number
  maxCount: number
}

interface SecuritySnapshot {
  windowHours: number
  totalRequests: number
  routes: RouteAccessStat[]
  throttle: ThrottleSignal[]
}

const POLL_INTERVAL_MS = 10_000

export function SecurityClient() {
  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const response = await fetch('/api/admin/security', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setSnapshot((await response.json()) as SecuritySnapshot & { ok: true })
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
        <h1 className="text-xl font-semibold">安全监控</h1>
        <div className="flex items-center gap-3 text-[12px] text-ds-text-muted">
          {updatedAt && <span>更新于 {formatClock(updatedAt)} · 每 10 秒自动刷新</span>}
          <Button variant="gray" size="sm" icon={RefreshCw} onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      <p className="text-[12px] text-ds-text-muted">
        应用层业务可观测：接口访问放量、401/404 探测与登录/验证码限流信号。DDoS/CC
        级防护应由边缘层（如反向代理限速）承担，二者不互相替代。
      </p>

      {error && (
        <p className="rounded-md bg-ds-red-soft px-3 py-2 text-[13px] text-ds-red">
          快照拉取失败：{error}
        </p>
      )}

      {!snapshot && !error && <p className="text-[13px] text-ds-text-muted">加载中…</p>}

      {snapshot && (
        <>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <CardTitle>限流 / 攻击信号</CardTitle>
              <span className="text-[12px] text-ds-text-muted">当前活跃窗口内</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {snapshot.throttle.map((signal) => {
                const triggered = signal.atOrOverLimit > 0
                return (
                  <Card key={signal.rule}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[13px] font-medium">{signal.label}</div>
                      <StatusPill
                        variant={triggered ? 'failed' : 'rendered'}
                        label={triggered ? `触发 ${signal.atOrOverLimit}` : '正常'}
                      />
                    </div>
                    <div className="mt-2 text-2xl font-semibold tabular-nums">
                      {signal.activeKeys}
                    </div>
                    <div className="mt-1 text-[12px] text-ds-text-muted">
                      活跃维度 · 峰值 {signal.maxCount}/{signal.limit} 每
                      {formatWindow(signal.windowMs)}
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>

          <Card className="p-0">
            <div className="flex items-baseline justify-between px-5 pb-1 pt-5">
              <CardTitle>接口访问（近 {snapshot.windowHours} 小时）</CardTitle>
              <span className="text-[12px] text-ds-text-muted">
                合计 {snapshot.totalRequests} 次
              </span>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
                  <th className="px-5 py-3 font-medium">接口</th>
                  <th className="px-3 py-3 font-medium">总数</th>
                  <th className="px-3 py-3 font-medium">401</th>
                  <th className="px-3 py-3 font-medium">404</th>
                  <th className="px-3 py-3 font-medium">5xx</th>
                  <th className="px-5 py-3 font-medium">错误率</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.routes.map((row) => (
                  <tr
                    key={row.routeGroup}
                    className="border-b border-ds-border/60 last:border-b-0"
                  >
                    <td className="px-5 py-3 font-medium">{row.routeGroup}</td>
                    <td className="px-3 py-3 tabular-nums">{row.total}</td>
                    <td className="px-3 py-3 tabular-nums">{row.unauthorized}</td>
                    <td className="px-3 py-3 tabular-nums">{row.notFound}</td>
                    <td className="px-3 py-3 tabular-nums">{row.serverError}</td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          row.errorRate >= 0.5
                            ? 'font-medium text-ds-red'
                            : 'text-ds-text-muted'
                        }
                      >
                        {Math.round(row.errorRate * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
                {snapshot.routes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-ds-text-muted">
                      窗口内暂无接口访问记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

function formatWindow(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  return `${Math.round(hours / 24)} 天`
}
