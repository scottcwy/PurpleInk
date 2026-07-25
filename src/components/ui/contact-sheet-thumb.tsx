import { CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ContactSheetThumbProps {
  label: string
  frames?: string[]
  checked?: boolean
  className?: string
}

/**
 * QA 抽帧联系表缩略图（SSOT）。
 * canvas.pen: 160 宽、垂直布局；上方 3 个 52×30 小帧 + 底部标签/勾选。
 * checked 无默认值：调用方必须显式传入真实 QA 状态，undefined/false 时不渲染已通过勾选。
 */
export function ContactSheetThumb({
  label,
  frames = ['25%', '60%', '95%'],
  checked,
  className,
}: ContactSheetThumbProps) {
  return (
    <div className={cn('flex w-40 flex-col gap-1.5', className)}>
      <div className="flex gap-0.5">
        {frames.map((pct, i) => (
          <div
            key={i}
            className="flex h-[30px] w-[52px] flex-col justify-end rounded-sm bg-fill p-0.5"
          >
            <span className="text-center text-[9px] font-mono text-label-tertiary">{pct}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-sc text-label">{label}</span>
        {checked && <CircleCheck className="h-3.5 w-3.5 text-success" />}
      </div>
    </div>
  )
}
