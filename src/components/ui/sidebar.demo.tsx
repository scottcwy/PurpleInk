'use client'

import {
  Download,
  FolderKanban,
  LayoutDashboard,
  PanelTop,
  Waypoints,
} from 'lucide-react'
import { useState } from 'react'
import { PurpleInkSidebar } from './sidebar'

const DEMO_ITEMS = [
  { label: '工作台', icon: LayoutDashboard, active: true },
  { label: '项目', icon: FolderKanban },
  { label: '画布', icon: Waypoints },
  { label: '镜头', icon: PanelTop },
  { label: '导出', icon: Download },
] as const

export function SidebarDemo() {
  const [collapsed, setCollapsed] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  return (
    <div className="h-[720px] overflow-hidden rounded-lg border border-ds-border">
      <PurpleInkSidebar
        items={DEMO_ITEMS}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        accountOpen={accountOpen}
        onAccountOpenChange={setAccountOpen}
      />
    </div>
  )
}
