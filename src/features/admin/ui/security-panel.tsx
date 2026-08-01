import { ShieldCheck } from 'lucide-react'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import type { AdminSecuritySnapshot } from '../security-repository'

export function AdminSecurityPanel({ snapshot }: { snapshot: AdminSecuritySnapshot }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardTitle>限流桶</CardTitle>
        <CardBody className="text-3xl font-semibold tabular-nums text-ds-text">
          {snapshot.authThrottle.trackedBuckets}
        </CardBody>
      </Card>
      <Card>
        <CardTitle>限流累计尝试</CardTitle>
        <CardBody className="text-3xl font-semibold tabular-nums text-ds-text">
          {snapshot.authThrottle.attempts}
        </CardBody>
      </Card>
      <Card>
        <CardTitle>统计窗口</CardTitle>
        <CardBody className="text-3xl font-semibold tabular-nums text-ds-text">
          {snapshot.windowHours}h
        </CardBody>
      </Card>
      <Card className="lg:col-span-3">
        <CardTitle>API 访问结果</CardTitle>
        <CardBody>
          {snapshot.apiAccess.length === 0 ? (
            <div className="flex justify-center">
              <EmptyState icon={ShieldCheck} title="暂无访问计数" description="旁路计数尚未写入分钟桶。" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs text-ds-text-muted">
                  <tr><th className="py-2 pr-3 font-medium">路由组</th><th className="py-2 pr-3 font-medium">结果</th><th className="py-2 font-medium">次数</th></tr>
                </thead>
                <tbody>
                  {snapshot.apiAccess.map((item) => (
                    <tr key={`${item.routeGroup}:${item.outcome}`} className="border-t border-ds-border">
                      <td className="py-2 pr-3 font-mono text-xs">{item.routeGroup}</td>
                      <td className="py-2 pr-3">{item.outcome}</td>
                      <td className="py-2 font-mono tabular-nums">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
