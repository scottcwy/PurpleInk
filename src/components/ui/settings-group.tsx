import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsGroupProps {
  children: ReactNode
  className?: string
}

/**
 * 设置组（SSOT）。
 * canvas.pen: surface 底、rounded-md、shadow-card、垂直布局、clip。
 */
export function SettingsGroup({ children, className }: SettingsGroupProps) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-md bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SettingsSeparator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-separator', className)} />
}
