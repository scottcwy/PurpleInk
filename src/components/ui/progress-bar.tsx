import { cn } from '@/lib/utils'

export interface ProgressBarProps {
  value: number
  label?: string
  className?: string
}

/**
 * 进度条（SSOT）。
 * canvas.pen: label 标题 + label-secondary 百分比；fill 轨道、accent 填充。
 */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, value))
  return (
    <div className={cn('flex w-80 max-w-full flex-col gap-2 text-ds-text', className)}>
      <div className="flex items-center justify-between">
        {label && <span className="text-[13px] font-medium">{label}</span>}
        <span className="text-xs font-mono text-ds-text-muted">{percent}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-ds-surface-muted">
        <div
          className="h-1.5 rounded-full bg-ds-blue transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
