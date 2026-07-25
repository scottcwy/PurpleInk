'use client'

import { useState } from 'react'
import { AccountMenu, SidebarAccount, SidebarToggle } from './sidebar-chrome'

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
  return <SidebarAccount />
}

export function AccountMenuDemo() {
  return <AccountMenu />
}
