import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SettingsRowProps {
  label: string
  value?: string
  children?: React.ReactNode
  className?: string
  /** 尾部 chevron 箭头；仅用于可进入的行，纯表单行应传 false。默认 true。 */
  chevron?: boolean
}

/**
 * 设置行（SSOT）。
 * canvas.pen: 高 11（44px）、px-4、左右分布；
 * 左侧 label 15px，右侧 value（mono）+ chevron。
 */
export function SettingsRow({ label, value, children, className, chevron = true }: SettingsRowProps) {
  return (
    <div
      className={cn(
        'flex h-11 min-w-0 items-center justify-between px-4',
        className,
      )}
    >
      <span className="shrink-0 text-sm text-ds-text">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {value && (
          <span className="truncate text-xs font-mono text-ds-text-muted">
            {value}
          </span>
        )}
        {children}
        {chevron && <ChevronRight className="size-4 shrink-0 text-ds-text-muted" />}
      </div>
    </div>
  )
}
