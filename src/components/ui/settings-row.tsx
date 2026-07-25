import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SettingsRowProps {
  label: string
  value?: string
  children?: React.ReactNode
  className?: string
}

/**
 * 设置行（SSOT）。
 * canvas.pen: 高 11（44px）、px-4、左右分布；
 * 左侧 label 15px，右侧 value（mono）+ chevron。
 */
export function SettingsRow({ label, value, children, className }: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex h-11 items-center justify-between px-4',
        className,
      )}
    >
      <span className="text-sm font-sc text-ds-text">{label}</span>
      <div className="flex items-center gap-2">
        {value && <span className="text-xs font-mono text-ds-text-muted">{value}</span>}
        {children}
        <ChevronRight className="size-4 text-ds-text-muted" />
      </div>
    </div>
  )
}
