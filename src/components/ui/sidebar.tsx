import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Clapperboard } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SidebarProps {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** 图标条态：收窄为 64px，隐藏文字型子件 */
  compact?: boolean
}

/**
 * 侧边栏（SSOT）。
 * canvas.pen: 宽 60（240px）、glass-sidebar 底、右侧 separator 边框、
 * backdrop-blur-[20px]、垂直布局、gap-1、p-4。
 */
export function Sidebar({ children, className, style, compact }: SidebarProps) {
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

export interface SidebarBrandProps {
  className?: string
  compact?: boolean
}

export function SidebarBrand({ className, compact }: SidebarBrandProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1',
        compact ? 'justify-center px-0' : 'px-2.5',
        className,
      )}
    >
      <Clapperboard className="h-5 w-5 shrink-0 text-accent" />
      {!compact && (
        <span className="text-[17px] font-semibold font-sc text-label">CodeVideoCanvas</span>
      )}
    </div>
  )
}

export type SidebarSearchProps = InputHTMLAttributes<HTMLInputElement> & {
  compact?: boolean
}

export function SidebarSearch({
  placeholder = '搜索项目',
  className,
  compact,
  ...props
}: SidebarSearchProps) {
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
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-sc text-label outline-none placeholder:text-label-tertiary"
        placeholder={placeholder}
        {...props}
      />
    </div>
  )
}

export interface SidebarSectionProps {
  children: ReactNode
  className?: string
  compact?: boolean
}

export function SidebarSection({ children, className, compact }: SidebarSectionProps) {
  if (compact) return null
  return (
    <div className={cn('px-2.5 py-1 text-xs font-sc text-label-tertiary', className)}>
      {children}
    </div>
  )
}

export interface SidebarNavProps {
  children: ReactNode
  className?: string
}

export function SidebarNav({ children, className }: SidebarNavProps) {
  return <nav className={cn('flex flex-1 flex-col gap-0.5', className)}>{children}</nav>
}

export interface SidebarFooterProps {
  children: ReactNode
  className?: string
}

export function SidebarFooter({ children, className }: SidebarFooterProps) {
  return <div className={cn('mt-auto', className)}>{children}</div>
}

export interface SidebarLocalStatusProps {
  label?: string
  className?: string
  compact?: boolean
}

export function SidebarLocalStatus({
  label = '本地存储 · 模型直连',
  className,
  compact,
}: SidebarLocalStatusProps) {
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
      {!compact && <span className="text-xs font-sc text-label-tertiary">{label}</span>}
    </div>
  )
}

export function SidebarDivider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-separator', className)} />
}
