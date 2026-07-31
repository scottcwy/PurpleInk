import { ShieldCheck } from 'lucide-react'
import { StatusPill } from './status-pill'

/** StatusPill 五态 + icon 变体示例（/playbook 展示单元）。 */
export function StatusPillDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusPill variant="pending" />
      <StatusPill variant="generating" />
      <StatusPill variant="rendered" />
      <StatusPill variant="cached" />
      <StatusPill variant="stale" />
      <StatusPill variant="failed" />
      <StatusPill variant="rendered" icon={ShieldCheck} label="本地优先" />
    </div>
  )
}
