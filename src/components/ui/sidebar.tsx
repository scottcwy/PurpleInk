'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PurpleInkLogo } from './purple-ink-logo'
import { AccountMenu, SidebarAccount, SidebarToggle } from './sidebar-chrome'

export interface PurpleInkSidebarItem {
  label: string
  icon: LucideIcon
  href?: string
  active?: boolean
  disabledReason?: string
}

export interface PurpleInkSidebarProps {
  items: readonly PurpleInkSidebarItem[]
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  accountOpen: boolean
  onAccountOpenChange: (open: boolean) => void
  className?: string
}

export function PurpleInkSidebar({
  items,
  collapsed,
  onCollapsedChange,
  accountOpen,
  onAccountOpenChange,
  className,
}: PurpleInkSidebarProps) {
  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col gap-3.5 border-r border-ds-border p-3 transition-[width] duration-200',
        'bg-[linear-gradient(180deg,var(--ds-gradient-start),var(--ds-gradient-mid)_52%,var(--ds-gradient-end))]',
        collapsed ? 'w-[76px]' : 'w-[248px]',
        className,
      )}
    >
      <header className="flex h-10 items-center justify-between gap-3">
        <Link href="/dashboard" aria-label="PurpleInk 工作台">
          <PurpleInkLogo compact={collapsed} />
        </Link>
        {!collapsed ? (
          <SidebarToggle
            collapsed={false}
            onClick={() => onCollapsedChange(true)}
          />
        ) : null}
      </header>

      {collapsed ? (
        <SidebarToggle
          collapsed
          className="mx-auto"
          onClick={() => onCollapsedChange(false)}
        />
      ) : null}

      <nav aria-label="产品主导航" className="flex flex-1 flex-col gap-[3px]">
        {items.map((item) => (
          <SidebarNavigationItem
            key={item.label}
            item={item}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div className="relative">
        {accountOpen && !collapsed ? (
          <div className="absolute bottom-[66px] left-0 z-40">
            <AccountMenu />
          </div>
        ) : null}
        <SidebarAccount
          compact={collapsed}
          onSettings={() => onAccountOpenChange(!accountOpen)}
        />
      </div>
    </aside>
  )
}

function SidebarNavigationItem({
  item,
  collapsed,
}: {
  item: PurpleInkSidebarItem
  collapsed: boolean
}) {
  const classes = cn(
    'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
    collapsed && 'justify-center px-0',
    item.active
      ? 'bg-ds-surface-muted font-semibold text-ds-text'
      : 'text-ds-text-muted hover:bg-ds-surface-muted hover:text-ds-text',
  )
  const content = (
    <>
      <item.icon aria-hidden className="size-4 shrink-0" />
      {!collapsed ? item.label : null}
    </>
  )

  return item.href ? (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={item.active ? 'page' : undefined}
      className={classes}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      disabled
      title={item.disabledReason}
      className={cn(
        classes,
        'cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ds-text-muted',
      )}
    >
      {content}
    </button>
  )
}
