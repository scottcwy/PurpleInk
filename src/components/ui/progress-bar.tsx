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
    <div className={cn('flex w-60 flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between">
        {label && <span className="text-[13px] font-sc text-label">{label}</span>}
        <span className="text-[13px] font-sc text-label-secondary">{percent}%</span>
      </div>
      <div className="h-1 w-full rounded-sm bg-fill">
        <div
          className="h-1 rounded-sm bg-accent transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
