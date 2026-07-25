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
  pending: {
    bg: 'bg-ds-surface-muted',
    color: 'text-ds-text-muted',
    defaultLabel: '待生成',
  },
  generating: { bg: 'bg-ds-blue-soft', color: 'text-ds-blue', defaultLabel: '生成中' },
  rendered: { bg: 'bg-ds-green-soft', color: 'text-ds-green', defaultLabel: '已渲染' },
  cached: { bg: 'bg-ds-blue-soft', color: 'text-ds-blue', defaultLabel: '已缓存' },
  stale: { bg: 'bg-ds-amber-soft', color: 'text-ds-amber', defaultLabel: '需重渲' },
  failed: { bg: 'bg-ds-red-soft', color: 'text-ds-red', defaultLabel: '失败' },
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
        'inline-flex items-center gap-1.5 rounded-full border border-ds-border px-2 py-1',
        style.bg,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full bg-current', style.color)} />
      <span className={cn('text-[11px] font-medium', style.color)}>
        {label ?? style.defaultLabel}
      </span>
    </div>
  )
}
