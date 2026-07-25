'use client'

import { Sparkles } from 'lucide-react'
import { CollapsibleCard } from './collapsible-card'

/** CollapsibleCard 示例（/playbook 展示单元）：展开态流式日志 + 收起态。 */
export function CollapsibleCardDemo() {
  return (
    <div className="flex w-[320px] flex-col gap-3">
      <CollapsibleCard title="AI 流式输出" icon={Sparkles} meta="128 字" defaultOpen>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-label-secondary">
          {`const tl = gsap.timeline({ paused: true })
tl.from('.title', { y: 40, opacity: 0 })`}
        </pre>
      </CollapsibleCard>
      <CollapsibleCard title="Direct 风格圣经" meta="收起" defaultOpen={false}>
        <p className="text-[13px] text-label-secondary">展开查看已生成的风格圣经全文。</p>
      </CollapsibleCard>
    </div>
  )
}
