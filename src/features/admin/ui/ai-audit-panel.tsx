import { Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/status-pill'
import type { AdminAiAuditSnapshot } from '../ai-audit-repository'

export function AdminAiAuditPanel({ snapshot }: { snapshot: AdminAiAuditSnapshot }) {
  if (snapshot.items.length === 0) {
    return (
      <div className="flex justify-center rounded-xl border border-ds-border bg-ds-surface">
        <EmptyState
          icon={Sparkles}
          title="暂无 v3 调用记录"
          description={`最近 ${snapshot.days} 天没有可聚合的 ai_invocations v3。`}
        />
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-ds-border bg-ds-surface">
      <table className="w-full min-w-[1180px] text-left text-sm">
        <thead className="bg-ds-surface-muted text-xs text-ds-text-muted">
          <tr>
            {['逻辑模型', '出网模型', '部署 / Channel', '资金', 'Failure domain', '状态', '调用数', '官方成本', '权益扣减', '最近调用'].map((label) => (
              <th key={label} className="px-4 py-3 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.items.map((item, index) => (
            <tr key={`${item.logicalModelId}:${item.outboundModelId}:${item.status}:${index}`} className="border-t border-ds-border">
              <Cell mono>{item.logicalModelId}</Cell>
              <Cell mono>{item.outboundModelId}</Cell>
              <Cell><span className="block">{item.deploymentId}</span><span className="text-xs text-ds-text-muted">{item.channelId}</span></Cell>
              <Cell>{item.funding}</Cell>
              <Cell mono>{item.failureDomainId}</Cell>
              <Cell><StatusPill variant={item.status === 'failed' ? 'failed' : item.status === 'succeeded' ? 'rendered' : 'generating'} label={item.status} /></Cell>
              <Cell mono>{item.invocationCount}</Cell>
              <Cell mono>{formatCnyMicros(item.officialCostCnyMicros)}</Cell>
              <Cell mono>{formatCnyMicros(item.entitlementDebitCnyMicros)}</Cell>
              <Cell mono>{item.lastInvokedAt}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-4 py-3 align-top ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
}

function formatCnyMicros(raw: string): string {
  const micros = BigInt(raw)
  const microsPerUnit = BigInt(1_000_000)
  const whole = micros / microsPerUnit
  const fractional = (micros % microsPerUnit).toString().padStart(6, '0').replace(/0+$/, '')
  return `¥${whole}${fractional ? `.${fractional}` : ''}`
}
