import { cn } from '@/lib/utils'

export type StatusPillVariant =
  | 'pending'
  | 'generating'
  | 'rendered'
  | 'cached'
  | 'stale'
  | 'failed'

export interface StatusPillProps {
  variant?: StatusPillVariant
  label?: string
  className?: string
}

const STYLES: Record<StatusPillVariant, { bg: string; color: string; defaultLabel: string }> = {
  pending: { bg: 'bg-fill', color: 'text-label-tertiary', defaultLabel: '待生成' },
  generating: { bg: 'bg-accent-fill', color: 'text-accent', defaultLabel: '生成中' },
  rendered: { bg: 'bg-success-fill', color: 'text-success', defaultLabel: '已渲染' },
  cached: { bg: 'bg-teal-fill', color: 'text-teal', defaultLabel: '已缓存' },
  stale: { bg: 'bg-warning-fill', color: 'text-warning', defaultLabel: '需重渲' },
  failed: { bg: 'bg-danger-fill', color: 'text-danger', defaultLabel: '失败' },
}

/**
 * 状态胶囊（SSOT）。
 * canvas.pen: pill 形、*-fill 底、6px 色点 + 11px 标签。
 */
export function StatusPill({ variant = 'pending', label, className }: StatusPillProps) {
  const style = STYLES[variant]
  return (
    <div
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-pill px-2.5',
        style.bg,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', style.color)} />
      <span className={cn('text-[11px] font-medium font-sc', style.color)}>
        {label ?? style.defaultLabel}
      </span>
    </div>
  )
}
