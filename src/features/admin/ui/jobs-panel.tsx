import { ListTree } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill'
import type { AdminJobsPage } from '../jobs-repository'

export function AdminJobsPanel({ page }: { page: AdminJobsPage }) {
  if (page.items.length === 0) {
    return (
      <div className="flex justify-center rounded-xl border border-ds-border bg-ds-surface">
        <EmptyState
          icon={ListTree}
          title="暂无运行记录"
          description="pipeline_runs 与 task_attempts 当前没有可展示的数据。"
        />
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-ds-border bg-ds-surface">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="bg-ds-surface-muted text-xs text-ds-text-muted">
          <tr>
            <HeaderCell>阶段</HeaderCell>
            <HeaderCell>Run / Attempt</HeaderCell>
            <HeaderCell>运行状态</HeaderCell>
            <HeaderCell>尝试状态</HeaderCell>
            <HeaderCell>安全错误类别</HeaderCell>
            <HeaderCell>创建时间</HeaderCell>
          </tr>
        </thead>
        <tbody>
          {page.items.map((item) => (
            <tr key={`${item.runId}:${item.attemptId ?? 'run'}`} className="border-t border-ds-border">
              <Cell>
                <span className="font-medium">{item.taskId ?? '尚未入队'}</span>
                <span className="mt-0.5 block text-xs text-ds-text-muted">{item.entityType ?? 'run'}</span>
              </Cell>
              <Cell className="font-mono text-xs">
                <span className="block">{shortId(item.runId)}</span>
                <span className="mt-0.5 block text-ds-text-muted">{shortId(item.attemptId)}</span>
              </Cell>
              <Cell><StatusPill variant={statusVariant(item.runStatus)} label={item.runStatus} /></Cell>
              <Cell>
                {item.attemptStatus
                  ? <StatusPill variant={statusVariant(item.attemptStatus)} label={item.attemptStatus} />
                  : <span className="text-ds-text-muted">—</span>}
              </Cell>
              <Cell>{item.failureCategory === 'none' ? '—' : item.failureCategory}</Cell>
              <Cell className="font-mono text-xs text-ds-text-muted">{item.attemptCreatedAt ?? item.runCreatedAt}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
}

function shortId(value: string | null): string {
  if (!value) return '—'
  return value.length > 12 ? `${value.slice(0, 8)}…` : value
}

function statusVariant(status: string): StatusPillVariant {
  if (status === 'failed') return 'failed'
  if (status === 'succeeded' || status === 'released') return 'rendered'
  if (status === 'running' || status === 'active' || status === 'in_flight') return 'generating'
  if (status === 'cancelled' || status === 'superseded' || status === 'expired') return 'stale'
  return 'pending'
}
