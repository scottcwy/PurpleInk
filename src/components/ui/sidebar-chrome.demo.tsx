'use client'

import { useState } from 'react'
import {
  AccountMenu,
  SidebarAccount,
  SidebarToggle,
  type SidebarAccountInfo,
} from './sidebar-chrome'

/** playbook 登记专用 fixture，非真实会话数据。 */
const FIXTURE_ACCOUNT: SidebarAccountInfo = {
  name: '示例用户',
  email: 'demo@example.com',
  workspaceName: '示例工作区',
}

export function SidebarToggleDemo() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <SidebarToggle
      collapsed={collapsed}
      onClick={() => setCollapsed((current) => !current)}
    />
  )
}

export function SidebarAccountDemo() {
  return <SidebarAccount account={FIXTURE_ACCOUNT} />
}

export function AccountMenuDemo() {
  // fixture 登出：只演示 pending → 失败文本态，不调真实 API。
  return (
    <AccountMenu
      account={FIXTURE_ACCOUNT}
      onLogout={() =>
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 600))
      }
    />
  )
}
