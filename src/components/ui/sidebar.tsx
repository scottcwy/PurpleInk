'use client'

import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { PurpleInkLogo } from './purple-ink-logo'
import { focusFirstMenuItem, moveMenuFocus } from './menu-focus'
import { Popover } from './popover'
import {
  AccountMenu,
  SidebarAccount,
  SidebarToggle,
  type SidebarAccountInfo,
} from './sidebar-chrome'

export type { SidebarAccountInfo }

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
  account?: SidebarAccountInfo | null
  /** 透传给账户菜单的登出动作；不传则按钮禁用。 */
  onLogout?: () => Promise<boolean>
  brandHref?: string
  settingsHref?: string
  className?: string
}

export function PurpleInkSidebar({
  items,
  collapsed,
  onCollapsedChange,
  accountOpen,
  onAccountOpenChange,
  account,
  onLogout,
  brandHref = '/',
  settingsHref,
  className,
}: PurpleInkSidebarProps) {
  const accountMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!accountOpen || collapsed) return
    const frame = requestAnimationFrame(() => focusFirstMenuItem(accountMenuRef.current))
    return () => cancelAnimationFrame(frame)
  }, [accountOpen, collapsed])

  function handleAccountMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    moveMenuFocus(accountMenuRef.current, event.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-ds-border',
        'bg-[linear-gradient(180deg,var(--ds-gradient-start),var(--ds-gradient-mid)_52%,var(--ds-gradient-end))]',
        collapsed ? 'gap-2.5 p-2' : 'gap-3.5 p-3',
        className,
      )}
    >
      <header
        className={cn(
          'flex h-10 items-center gap-3',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        {collapsed ? (
          <SidebarToggle
            collapsed
            className="size-9"
            onClick={() => onCollapsedChange(false)}
          />
        ) : (
          <>
            <Link href={brandHref} aria-label="PurpleInk 首页">
              <PurpleInkLogo />
            </Link>
            <SidebarToggle
              collapsed={false}
              onClick={() => onCollapsedChange(true)}
            />
          </>
        )}
      </header>

      <nav aria-label="产品主导航" className="flex flex-1 flex-col gap-[3px]">
        {items.map((item) => (
          <SidebarNavigationItem
            key={item.label}
            item={item}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <Popover
        open={accountOpen && !collapsed}
        onOpenChange={onAccountOpenChange}
        align="start"
        side="top"
        role="menu"
        ariaLabel="账户菜单"
        className="w-full"
        contentRef={accountMenuRef}
        onContentKeyDown={handleAccountMenuKeyDown}
        contentClassName="w-auto max-w-none border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
        trigger={
          <SidebarAccount
            className="w-full"
            compact={collapsed}
            account={account}
            onSettings={() => onAccountOpenChange(!accountOpen)}
          />
        }
      >
        <AccountMenu settingsHref={settingsHref} account={account} onLogout={onLogout} />
      </Popover>
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
    'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-fast ease-standard',
    collapsed && 'justify-center px-0',
    item.active
      ? 'bg-ds-surface-muted font-semibold text-ds-text'
      : 'text-ds-text-muted hover:bg-ds-surface-muted hover:text-ds-text',
  )
  const content = (
    <>
      <item.icon aria-hidden className="size-4 shrink-0 translate-y-[-0.5px]" />
      {!collapsed ? item.label : null}
    </>
  )

  return item.href ? (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
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
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        classes,
        'cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ds-text-muted',
      )}
    >
      {content}
    </button>
  )
}
