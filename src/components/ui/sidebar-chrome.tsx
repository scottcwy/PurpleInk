'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Info,
  LoaderCircle,
  LogOut,
  Settings,
  SunMoon,
  UserRound,
} from 'lucide-react'
import { useThemeMode } from '@/lib/hooks/use-theme-mode'
import { nextThemeMode, themeModeLabel } from '@/lib/theme-mode'
import { cn } from '@/lib/utils'

export function SidebarToggle({
  collapsed,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { collapsed: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-sm border border-ds-border text-ds-text transition-colors duration-fast ease-standard hover:bg-ds-surface-muted',
        className,
      )}
      aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
      aria-expanded={!collapsed}
      {...props}
    >
      <svg aria-hidden className="size-5" viewBox="0 0 20 20" fill="none">
        <path
          d={
            collapsed
              ? 'M1 1h18v18H1V1Zm6 0v18m4-12 3 3-3 3'
              : 'M1 1h18v18H1V1Zm6 0v18m7-12-3 3 3 3'
          }
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    </button>
  )
}

export function DefaultAvatar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative block size-9 shrink-0 overflow-hidden rounded-full border border-ds-border bg-ds-blue-soft text-ds-text',
        className,
      )}
      aria-hidden
    >
      <span className="absolute left-3 top-2 size-3 rounded-full bg-current" />
      <svg className="absolute left-[7px] top-[21px] h-[10px] w-[22px]" viewBox="0 0 22 11">
        <path d="M1 10C1.8 4.3 5.9 1 11 1s9.2 3.3 10 9H1Z" fill="currentColor" />
      </svg>
    </span>
  )
}

/** 侧栏账户区展示的会话投影；由 features 侧从 SessionOwner 映射，null = 未登录边缘态。 */
export interface SidebarAccountInfo {
  name: string
  email: string
  workspaceName: string
}

export function SidebarAccount({
  compact = false,
  className,
  onSettings,
  account,
}: {
  compact?: boolean
  className?: string
  onSettings?: () => void
  account?: SidebarAccountInfo | null
}) {
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border-t border-ds-border pt-2.5',
          className,
        )}
      >
        <DefaultAvatar />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-14 items-center justify-between gap-2 border-t border-ds-border pt-2.5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <DefaultAvatar />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ds-text">
            {account?.name ?? '未登录'}
          </span>
          <span className="block truncate text-[10px] text-ds-text-muted">
            {account?.email ?? '—'}
          </span>
        </span>
      </div>
      <button
        type="button"
        className="flex size-[34px] shrink-0 items-center justify-center rounded text-ds-text transition-colors duration-fast ease-standard hover:bg-ds-surface-muted"
        aria-label="打开账户菜单"
        onClick={onSettings}
      >
        <Settings aria-hidden className="size-[18px]" />
      </button>
    </div>
  )
}

const ACCOUNT_ITEMS = [
  [UserRound, '个人资料'],
  [Settings, '工作区设置'],
  [SunMoon, '外观'],
  [Info, '帮助与反馈'],
] as const

/** 登出失败提示保留时长（业务逻辑常量，非动效 token）：到期自动复位为 idle。 */
const LOGOUT_FAILED_RESET_MS = 5_000

export function AccountMenu({
  footer,
  settingsHref,
  account,
  onLogout,
}: {
  footer?: ReactNode
  settingsHref?: string
  account?: SidebarAccountInfo | null
  /** 返回 false 表示登出失败（成功时整页跳转，不会回到这里）。 */
  onLogout?: () => Promise<boolean>
}) {
  const { mode, setTheme } = useThemeMode()
  const appearanceLabel = `外观 · ${themeModeLabel(mode)}`
  const [logoutState, setLogoutState] = useState<'idle' | 'pending' | 'failed'>('idle')

  // failed 态是瞬时提示：停留 5 秒后自动复位，期间仍可点击立即重试。
  useEffect(() => {
    if (logoutState !== 'failed') return
    const timer = setTimeout(() => setLogoutState('idle'), LOGOUT_FAILED_RESET_MS)
    return () => clearTimeout(timer)
  }, [logoutState])

  return (
    <div className="w-56 rounded-lg border border-ds-border bg-ds-surface p-1.5 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl">
      <div className="flex items-center gap-2.5 p-2">
        <DefaultAvatar />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {account?.name ?? '未登录'}
          </span>
          <span className="block truncate font-mono text-[10px] text-ds-text-muted">
            {account?.workspaceName ?? '—'}
          </span>
        </span>
      </div>
      <div className="my-0.5 h-px bg-ds-border" />
      {ACCOUNT_ITEMS.map(([Icon, label]) => {
        if (label === '工作区设置' && settingsHref) {
          return (
            <Link
              key={label}
              href={settingsHref}
              role="menuitem"
              data-menu-item
              className="flex h-9 w-full items-center gap-2.5 rounded px-2.5 text-left text-xs text-ds-text transition-colors duration-fast ease-standard hover:bg-ds-surface-muted"
            >
              <Icon aria-hidden className="size-4 text-ds-text-muted" />
              {label}
            </Link>
          )
        }

        if (label === '外观') {
          return (
            <button
              key={label}
              type="button"
              role="menuitem"
              data-menu-item
              aria-label={`${appearanceLabel}，点击切换`}
              title={appearanceLabel}
              className="flex h-9 w-full items-center gap-2.5 rounded px-2.5 text-left text-xs text-ds-text transition-colors duration-fast ease-standard hover:bg-ds-surface-muted"
              onClick={() => setTheme(nextThemeMode(mode))}
            >
              <Icon aria-hidden className="size-4 text-ds-text-muted" />
              {appearanceLabel}
            </button>
          )
        }

        return (
          <button
            key={label}
            type="button"
            role="menuitem"
            data-menu-item
            disabled
            title="该操作将在 Stage B 接线"
            className="flex h-9 w-full items-center gap-2.5 px-2.5 text-left text-xs text-ds-text opacity-70"
          >
            <Icon aria-hidden className="size-4 text-ds-text-muted" />
            {label}
          </button>
        )
      })}
      <div className="my-0.5 h-px bg-ds-border" />
      <button
        type="button"
        role="menuitem"
        data-menu-item
        disabled={!onLogout || logoutState === 'pending'}
        className="flex h-9 w-full items-center gap-2.5 rounded px-2.5 text-left text-xs text-ds-red transition-colors duration-fast ease-standard hover:bg-ds-surface-muted disabled:opacity-70 disabled:hover:bg-transparent"
        onClick={() => {
          if (!onLogout || logoutState === 'pending') return
          setLogoutState('pending')
          // 成功路径由 performLogout 整页跳转 /login，不需要复位；
          // 失败时用文本态提示重试（状态不能只靠颜色，AGENTS §6）。
          void onLogout().then((ok) => {
            if (!ok) setLogoutState('failed')
          })
        }}
      >
        {logoutState === 'pending' ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
        ) : (
          <LogOut aria-hidden className="size-4" />
        )}
        {logoutState === 'pending'
          ? '正在退出…'
          : logoutState === 'failed'
            ? '退出失败，点击重试'
            : '退出登录'}
      </button>
      {footer}
    </div>
  )
}
