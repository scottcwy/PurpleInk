import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsGroupProps {
  children: ReactNode
  className?: string
}

/**
 * 设置组（SSOT）。
 * canvas.pen: ds-surface 底、8px 圆角、ds-border、垂直布局、clip。
 */
export function SettingsGroup({ children, className }: SettingsGroupProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-surface text-ds-text',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SettingsSeparator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-ds-border', className)} />
}
