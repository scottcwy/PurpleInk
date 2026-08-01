'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { BadgeDollarSign, TicketCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/status-pill'
import { TextField } from '@/components/ui/text-field'
import type { AdminBillingSnapshot } from '../billing-admin'

export function AdminBillingPanel({ snapshot }: { snapshot: AdminBillingSnapshot }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<{ id: string; label: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/billing/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planKey: form.get('planKey'),
          label: form.get('label'),
          count: Number(form.get('count')),
          expiresAt: form.get('expiresAt') || null,
        }),
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readError(result))
      if (!isCodeResponse(result)) throw new Error('服务端未返回兑换码')
      setCreating(false)
      setCodes(result.codes)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建批次失败')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(): Promise<void> {
    if (!revoking) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/billing/batches/${revoking.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', confirmation: 'REVOKE' }),
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readError(result))
      setRevoking(null)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销批次失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.plans.map((plan) => (
          <Card key={plan.key}>
            <CardTitle>{plan.displayName}</CardTitle>
            <CardBody>{plan.concurrency} 路并发 · {plan.managedProviders.length} 个托管 Provider</CardBody>
            <p className="mt-3 font-mono text-xs text-ds-text-muted">{plan.version}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardTitle>官方成本账本</CardTitle><CardBody className="text-2xl font-semibold tabular-nums text-ds-text">{formatLedger(snapshot.ledgers.officialCost.totalCnyMicros, snapshot.ledgers.officialCost.knownCnyMicros)}</CardBody><p className="mt-1 text-xs text-ds-text-muted">{snapshot.ledgers.officialCost.knownEntryCount} / {snapshot.ledgers.officialCost.entryCount} 条有已知人民币成本</p></Card>
        <Card><CardTitle>权益扣减账本</CardTitle><CardBody className="text-2xl font-semibold tabular-nums text-ds-text">{formatLedger(snapshot.ledgers.entitlement.totalDebitCnyMicros, snapshot.ledgers.entitlement.knownDebitCnyMicros)}</CardBody><p className="mt-1 text-xs text-ds-text-muted">{snapshot.ledgers.entitlement.entryCount} 条 entitlement_ledger_entries</p></Card>
      </div>
      <Card>
        <CardTitle>Workspace 权益</CardTitle>
        <CardBody>
          {snapshot.entitlements.length === 0 ? (
            <div className="flex justify-center"><EmptyState icon={BadgeDollarSign} title="暂无权益" /></div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-ds-text-muted"><tr><Header>Workspace</Header><Header>方案</Header><Header>状态</Header><Header>到期时间</Header></tr></thead>
                <tbody>{snapshot.entitlements.map((item) => <tr key={item.workspaceId} className="border-t border-ds-border"><Cell>{item.workspaceName}</Cell><Cell>{item.planKey}</Cell><Cell><StatusPill variant={item.status === 'active' ? 'rendered' : 'stale'} label={item.status} /></Cell><Cell className="font-mono text-xs">{formatDate(item.expiresAt)}</Cell></tr>)}</tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div><CardTitle>兑换批次</CardTitle><CardBody>数据库只保留 HMAC 哈希；明文码仅在创建响应中显示一次。</CardBody></div>
          <Button icon={TicketCheck} onClick={() => { setError(null); setCreating(true) }}>创建批次</Button>
        </div>
        {error && <p role="alert" className="mx-5 mb-4 rounded-md border border-ds-red/30 bg-ds-red-soft px-4 py-3 text-sm text-ds-red">{error}</p>}
        {snapshot.batches.length === 0 ? (
          <div className="flex justify-center border-t border-ds-border"><EmptyState icon={TicketCheck} title="暂无兑换批次" /></div>
        ) : (
          <div className="overflow-x-auto border-t border-ds-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-ds-surface-muted text-xs text-ds-text-muted"><tr><Header>批次</Header><Header>方案</Header><Header>使用情况</Header><Header>状态</Header><Header>到期时间</Header><Header>操作</Header></tr></thead>
              <tbody>{snapshot.batches.map((batch) => <tr key={batch.id} className="border-t border-ds-border"><Cell>{batch.label}</Cell><Cell>{batch.planKey}</Cell><Cell>{batch.consumedCodes} / {batch.totalCodes}</Cell><Cell><StatusPill variant={batch.revokedAt ? 'stale' : 'rendered'} label={batch.revokedAt ? '已撤销' : '可兑换'} /></Cell><Cell className="font-mono text-xs">{batch.expiresAt ? formatDate(batch.expiresAt) : '不过期'}</Cell><Cell>{batch.revokedAt ? '—' : <Button size="sm" variant="destructive" onClick={() => setRevoking({ id: batch.id, label: batch.label })}>撤销</Button>}</Cell></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Dialog open={creating} onClose={() => setCreating(false)} title="创建兑换批次" description="每个兑换码仅可使用一次，权益周期固定为 30 天。">
        <form className="flex flex-col gap-4" onSubmit={create}>
          <label className="flex flex-col gap-2 text-[13px] font-medium text-ds-text">方案<select name="planKey" className="h-10 rounded-md border border-ds-border bg-ds-surface px-3 text-sm" defaultValue="plus"><option value="plus">Plus</option><option value="pro">Pro</option><option value="max">Max</option></select></label>
          <TextField name="label" label="批次名称" required />
          <TextField name="count" type="number" min={1} max={1000} label="兑换码数量" required />
          <TextField name="expiresAt" type="datetime-local" label="兑换截止时间（可选）" />
          <div className="flex justify-end gap-2"><Button type="button" variant="gray" onClick={() => setCreating(false)}>取消</Button><Button type="submit" loading={busy}>创建</Button></div>
        </form>
      </Dialog>
      <Dialog open={revoking !== null} onClose={() => setRevoking(null)} title="确认撤销批次" description={`撤销 ${revoking?.label ?? ''} 后，未使用兑换码将立即不可用；已生效权益不会回退。`} actions={<><Button variant="gray" onClick={() => setRevoking(null)}>取消</Button><Button variant="destructive" loading={busy} onClick={() => void revoke()}>确认撤销</Button></>} />
      <Dialog open={codes !== null} onClose={() => setCodes(null)} title="一次性兑换码" description="关闭后服务端不会再次返回这些明文码。请立即安全保存。">
        <pre className="max-h-72 overflow-auto rounded-md border border-ds-border bg-ds-surface-muted p-4 text-xs leading-6">{codes?.join('\n')}</pre>
        <div className="flex justify-end"><Button onClick={() => setCodes(null)}>我已保存</Button></div>
      </Dialog>
    </div>
  )
}

function Header({ children }: { children: React.ReactNode }) { return <th className="px-4 py-3 font-medium">{children}</th> }
function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <td className={`px-4 py-3 align-top ${className}`}>{children}</td> }
function readError(value: unknown): string { return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : '操作失败，请稍后重试' }
function isCodeResponse(value: unknown): value is { codes: string[] } { return Boolean(value && typeof value === 'object' && 'codes' in value && Array.isArray(value.codes) && value.codes.every((code) => typeof code === 'string')) }
function formatDate(value: string): string { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) }
function formatMicros(value: string): string { return `¥${(Number(value) / 1_000_000).toFixed(2)}` }
function formatLedger(total: string | null, known: string): string { return total === null ? `未知 · 已知 ${formatMicros(known)}` : formatMicros(total) }
