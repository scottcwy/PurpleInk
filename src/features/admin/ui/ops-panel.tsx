import { Clock3, ListTree } from 'lucide-react'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/status-pill'
import type { AdminOpsSnapshot } from '../ops-repository'

export function AdminOpsPanel({ snapshot }: { snapshot: AdminOpsSnapshot }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <StatusSummary title="任务队列" items={snapshot.queue} />
      <StatusSummary title="工作流租约" items={snapshot.workflowLeases} />
      <StatusSummary title="Provider tickets" items={snapshot.providerTickets} />
      <Card>
        <CardTitle>Provider 冷却</CardTitle>
        <CardBody>
          {snapshot.activeCooldowns.length === 0 ? (
            <InlineEmpty label="当前没有活跃冷却窗口" />
          ) : snapshot.activeCooldowns.map((item) => (
            <div key={item.provider} className="flex items-center justify-between gap-3 border-t border-ds-border py-2 first:border-t-0">
              <span>{item.provider}</span>
              <span className="text-xs text-ds-text-muted">{item.count} scopes · 至 {item.latestBlockedUntil}</span>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardTitle>Provider 并发池</CardTitle>
        <CardBody>
          {snapshot.providerPools.length === 0 ? (
            <div className="flex justify-center"><EmptyState icon={ListTree} title="暂无 Provider 状态" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {snapshot.providerPools.map((pool) => (
                <div key={pool.provider} className="rounded-lg border border-ds-border bg-ds-surface-muted p-3">
                  <div className="font-medium">{pool.provider}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-ds-text-muted">
                    <span>scope {pool.scopeCount}</span>
                    <span>失败 {pool.failureCount}</span>
                    <span className="col-span-2">并发 {pool.currentConcurrency} / {pool.maxConcurrency}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <div className="flex items-center gap-2"><Clock3 aria-hidden className="size-4 text-ds-text-muted" /><CardTitle>数据库时间</CardTitle></div>
        <CardBody className="font-mono text-ds-text">{snapshot.databaseTime}</CardBody>
      </Card>
    </div>
  )
}

function StatusSummary({ title, items }: { title: string; items: { status: string; count: number }[] }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        {items.length === 0 ? <InlineEmpty label="暂无记录" /> : items.map((item) => (
          <div key={item.status} className="flex items-center justify-between border-t border-ds-border py-2 first:border-t-0">
            <StatusPill label={item.status} variant={item.status === 'failed' ? 'failed' : item.status === 'running' || item.status === 'active' || item.status === 'in_flight' ? 'generating' : 'pending'} />
            <span className="font-mono text-sm tabular-nums">{item.count}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function InlineEmpty({ label }: { label: string }) {
  return <p className="py-3 text-sm text-ds-text-muted">{label}</p>
}
