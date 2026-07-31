'use client'

import { SectionNav } from './section-nav'

const DEMO_ITEMS = [
  { id: 'demo-providers', label: '模型服务' },
  { id: 'demo-routing', label: '节点路由' },
  { id: 'demo-appearance', label: '外观' },
] as const

/** SectionNav 示例（/playbook 展示单元）。 */
export function SectionNavDemo() {
  return (
    <div className="w-44">
      <SectionNav title="本页导航" items={DEMO_ITEMS} />
    </div>
  )
}
