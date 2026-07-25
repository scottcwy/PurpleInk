import type { ButtonHTMLAttributes, ReactNode } from 'react'
import {
  Info,
  LogOut,
  Settings,
  SunMoon,
  UserRound,
} from 'lucide-react'
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
        'flex size-8 shrink-0 items-center justify-center rounded-sm border border-ds-border text-ds-text transition-colors hover:bg-ds-surface-muted',
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

export function SidebarAccount({
  compact = false,
  onSettings,
}: {
  compact?: boolean
  onSettings?: () => void
}) {
  return (
    <div
      className={cn(
        'flex h-14 items-center justify-between gap-2 border-t border-ds-border pt-2.5',
        compact && 'justify-center',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <DefaultAvatar />
        {!compact ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ds-text">
              本地用户
            </span>
            <span className="block truncate text-[10px] text-ds-text-muted">
              PurpleInk Free
            </span>
          </span>
        ) : null}
      </div>
      {!compact ? (
        <button
          type="button"
          className="flex size-[34px] shrink-0 items-center justify-center rounded text-ds-text transition-colors hover:bg-ds-surface-muted"
          aria-label="打开账户菜单"
          onClick={onSettings}
        >
          <Settings aria-hidden className="size-[18px]" />
        </button>
      ) : null}
    </div>
  )
}

const ACCOUNT_ITEMS = [
  [UserRound, '个人资料'],
  [Settings, '工作区设置'],
  [SunMoon, '外观'],
  [Info, '帮助与反馈'],
] as const

export function AccountMenu({ footer }: { footer?: ReactNode }) {
  return (
    <div className="w-56 rounded-lg border border-ds-border bg-ds-surface p-1.5 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl">
      <div className="flex items-center gap-2.5 p-2">
        <DefaultAvatar />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">本地用户</span>
          <span className="block truncate font-mono text-[10px] text-ds-text-muted">
            workspace.local
          </span>
        </span>
      </div>
      <div className="my-0.5 h-px bg-ds-border" />
      {ACCOUNT_ITEMS.map(([Icon, label]) => (
        <button
          key={label}
          type="button"
          disabled
          title="该操作将在 Stage B 接线"
          className="flex h-9 w-full items-center gap-2.5 px-2.5 text-left text-xs text-ds-text opacity-70"
        >
          <Icon aria-hidden className="size-4 text-ds-text-muted" />
          {label}
        </button>
      ))}
      <div className="my-0.5 h-px bg-ds-border" />
      <button
        type="button"
        disabled
        title="认证将在 Stage B 接线"
        className="flex h-9 w-full items-center gap-2.5 px-2.5 text-left text-xs text-ds-red opacity-70"
      >
        <LogOut aria-hidden className="size-4" />
        退出登录
      </button>
      {footer}
    </div>
  )
}
