import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react'
import { Clapperboard, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LegacySidebarProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  compact?: boolean
}

export function LegacySidebar({
  children,
  className,
  style,
  compact,
}: LegacySidebarProps) {
  return (
    <aside
      data-compact={compact ? 'true' : undefined}
      style={style}
      className={cn(
        'flex h-full flex-col gap-1 border-r border-separator bg-glass-sidebar backdrop-blur-[20px]',
        compact ? 'w-16 items-center px-2 py-4' : 'w-60 p-4',
        className,
      )}
    >
      {children}
    </aside>
  )
}

export function LegacySidebarBrand({
  className,
  compact,
}: {
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1',
        compact ? 'justify-center px-0' : 'px-2.5',
        className,
      )}
    >
      <Clapperboard className="h-5 w-5 shrink-0 text-accent" />
      {!compact ? (
        <span className="font-sc text-[17px] font-semibold text-label">
          CodeVideoCanvas
        </span>
      ) : null}
    </div>
  )
}

export type LegacySidebarSearchProps = InputHTMLAttributes<HTMLInputElement> & {
  compact?: boolean
}

export function LegacySidebarSearch({
  placeholder = '搜索项目',
  className,
  compact,
  ...props
}: LegacySidebarSearchProps) {
  if (compact) return null
  return (
    <div
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md bg-fill px-2.5 text-label-tertiary',
        className,
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <input
        className="font-sc h-full min-w-0 flex-1 bg-transparent text-[13px] text-label outline-none placeholder:text-label-tertiary"
        placeholder={placeholder}
        {...props}
      />
    </div>
  )
}

export function LegacySidebarSection({
  children,
  className,
  compact,
}: {
  children: ReactNode
  className?: string
  compact?: boolean
}) {
  if (compact) return null
  return (
    <div className={cn('font-sc px-2.5 py-1 text-xs text-label-tertiary', className)}>
      {children}
    </div>
  )
}

export function LegacySidebarNav({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <nav className={cn('flex flex-1 flex-col gap-0.5', className)}>{children}</nav>
}

export function LegacySidebarFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('mt-auto', className)}>{children}</div>
}

export function LegacySidebarLocalStatus({
  label = '本地存储 · 模型直连',
  className,
  compact,
}: {
  label?: string
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 py-1',
        compact ? 'justify-center px-0' : 'px-2.5',
        className,
      )}
      title={compact ? label : undefined}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
      {!compact ? (
        <span className="font-sc text-xs text-label-tertiary">{label}</span>
      ) : null}
    </div>
  )
}

export function LegacySidebarDivider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-separator', className)} />
}
