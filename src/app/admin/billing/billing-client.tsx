'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'

/**
 * 订阅计费客户端：套餐分布卡 + 兑换码批次表 + 新建批次弹窗（明文码仅显示一次）
 * + 行内撤销（destructive 二次确认）。所有请求走 withAdminSession API。
 */

interface PlanDistributionItem {
  planKey: string
  displayName: string
  activeWorkspaces: number
}

interface RedemptionBatchRow {
  id: string
  label: string
  planKey: string
  durationDays: number
  totalCodes: number
  consumedCodes: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface BillingData {
  plans: PlanDistributionItem[]
  batches: RedemptionBatchRow[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 20

type PendingAction =
  | { kind: 'create' }
  | { kind: 'revoke'; batch: RedemptionBatchRow }

export function BillingClient() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<BillingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<PendingAction | null>(null)
  const [issuedCodes, setIssuedCodes] = useState<IssuedBatch | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      const response = await fetch(`/api/admin/billing?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setData((await response.json()) as BillingData & { ok: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">订阅计费</h1>
        <div className="flex items-center gap-2">
          <Button variant="gray" size="md" icon={RefreshCw} onClick={() => void load()}>
            刷新
          </Button>
          <Button size="md" icon={Plus} onClick={() => setAction({ kind: 'create' })}>
            新建批次
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-ds-red-soft px-3 py-2 text-[13px] text-ds-red">
          数据拉取失败：{error}
        </p>
      )}

      <div>
        <CardTitle className="mb-2">套餐分布</CardTitle>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(data?.plans ?? []).map((plan) => (
            <Card key={plan.planKey}>
              <div className="text-[13px] text-ds-text-muted">{plan.displayName}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">
                {plan.activeWorkspaces}
              </div>
              <div className="mt-1 text-[12px] text-ds-text-muted">活跃工作区</div>
            </Card>
          ))}
        </div>
      </div>

      <Card className="p-0">
        <div className="flex items-baseline justify-between px-5 pb-1 pt-5">
          <CardTitle>兑换码批次</CardTitle>
          <span className="text-[12px] text-ds-text-muted">
            共 {data?.total ?? 0} 批
          </span>
        </div>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ds-border text-[12px] text-ds-text-muted">
              <th className="px-5 py-3 font-medium">标签</th>
              <th className="px-3 py-3 font-medium">套餐</th>
              <th className="px-3 py-3 font-medium">时长</th>
              <th className="px-3 py-3 font-medium">已用 / 总数</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 font-medium">创建时间</th>
              <th className="px-5 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {(data?.batches ?? []).map((batch) => {
              const revoked = batch.revokedAt !== null
              return (
                <tr
                  key={batch.id}
                  className="border-b border-ds-border/60 last:border-b-0"
                >
                  <td className="px-5 py-3 font-medium">{batch.label}</td>
                  <td className="px-3 py-3 uppercase">{batch.planKey}</td>
                  <td className="px-3 py-3 tabular-nums">{batch.durationDays} 天</td>
                  <td className="px-3 py-3 tabular-nums">
                    {batch.consumedCodes} / {batch.totalCodes}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill
                      variant={revoked ? 'failed' : 'rendered'}
                      label={revoked ? '已撤销' : '有效'}
                    />
                  </td>
                  <td className="px-3 py-3 text-ds-text-muted">{formatTime(batch.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    {!revoked && (
                      <Button
                        variant="gray"
                        size="sm"
                        onClick={() => setAction({ kind: 'revoke', batch })}
                      >
                        撤销
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
            {(data?.batches.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-ds-text-muted">
                  暂无兑换码批次
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-end gap-3 text-[13px] text-ds-text-muted">
        <span>
          第 {data?.page ?? 1} / {totalPages} 页
        </span>
        <Button
          variant="gray"
          size="sm"
          disabled={(data?.page ?? 1) <= 1 || loading}
          onClick={() => setPage((current) => Math.max(current - 1, 1))}
        >
          上一页
        </Button>
        <Button
          variant="gray"
          size="sm"
          disabled={(data?.page ?? 1) >= totalPages || loading}
          onClick={() => setPage((current) => current + 1)}
        >
          下一页
        </Button>
      </div>

      {action?.kind === 'create' && (
        <CreateBatchDialog
          onClose={() => setAction(null)}
          onIssued={(issued) => {
            setAction(null)
            setIssuedCodes(issued)
            void load()
          }}
        />
      )}
      {action?.kind === 'revoke' && (
        <RevokeBatchDialog
          batch={action.batch}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null)
            void load()
          }}
        />
      )}
      {issuedCodes && (
        <IssuedCodesDialog issued={issuedCodes} onClose={() => setIssuedCodes(null)} />
      )}
    </div>
  )
}

interface IssuedBatch {
  label: string
  planKey: string
  codes: string[]
}

/** 统一读取 API 错误正文。 */
async function requestJson<T extends object>(
  input: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(input, init)
    const body = (await response.json().catch(() => null)) as
      | ({ ok?: boolean; error?: string } & T)
      | null
    if (response.ok && body?.ok) return { ok: true, data: body as T }
    return { ok: false, error: body?.error ?? `HTTP ${response.status}` }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

const PLAN_OPTIONS = [
  { value: 'plus', label: 'Plus' },
  { value: 'pro', label: 'Pro' },
  { value: 'max', label: 'Max' },
]

function CreateBatchDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void
  onIssued: (issued: IssuedBatch) => void
}) {
  const [planKey, setPlanKey] = useState('plus')
  const [count, setCount] = useState('10')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const result = await requestJson<{ label: string; planKey: string; codes: string[] }>(
      '/api/admin/billing/batches',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, count: Number(count), label: label.trim() }),
      },
    )
    setBusy(false)
    if (result.ok) {
      onIssued({ label: result.data.label, planKey: result.data.planKey, codes: result.data.codes })
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="新建兑换码批次"
      description="生成后明文码仅显示一次，请及时复制保存；系统只保存哈希，无法找回。"
      actions={
        <>
          <Button variant="gray" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? '生成中…' : '生成'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-medium">套餐</span>
          <SegmentedControl options={PLAN_OPTIONS} value={planKey} onChange={setPlanKey} />
        </div>
        <TextField
          label="数量"
          type="number"
          min={1}
          max={1000}
          className="w-full"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
        <TextField
          label="标签（便于识别，如 2025 春节推广）"
          className="w-full"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {error && <p className="text-[13px] text-ds-red">{error}</p>}
      </div>
    </Dialog>
  )
}

function IssuedCodesDialog({
  issued,
  onClose,
}: {
  issued: IssuedBatch
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const text = issued.codes.join('\n')

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`已生成 ${issued.codes.length} 个兑换码`}
      description={`批次「${issued.label}」· ${issued.planKey.toUpperCase()} 套餐。这些明文码仅显示这一次，关闭后无法再次查看。`}
      actions={
        <>
          <Button variant="gray" onClick={() => void copyAll()}>
            {copied ? '已复制' : '复制全部'}
          </Button>
          <Button onClick={onClose}>我已保存</Button>
        </>
      }
    >
      <div className="max-h-72 overflow-auto rounded-md border border-ds-border bg-ds-surface-muted p-3 font-mono text-[13px] leading-6">
        {issued.codes.map((code) => (
          <div key={code}>{code}</div>
        ))}
      </div>
    </Dialog>
  )
}

function RevokeBatchDialog({
  batch,
  onClose,
  onDone,
}: {
  batch: RedemptionBatchRow
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const result = await requestJson(`/api/admin/billing/batches/${batch.id}`, {
      method: 'PATCH',
    })
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.error)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="撤销兑换码批次"
      description={`批次「${batch.label}」下所有未使用的码将立即失效，已兑换的不受影响。此操作不可撤销。`}
      actions={
        <>
          <Button variant="gray" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>
            {busy ? '撤销中…' : '撤销'}
          </Button>
        </>
      }
    >
      {error && <p className="text-[13px] text-ds-red">{error}</p>}
    </Dialog>
  )
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
