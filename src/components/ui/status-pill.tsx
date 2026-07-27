import type { ComponentType } from 'react'
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
  /** 提供时以图标替代默认 6px 色点（Lucide 白名单）。 */
  icon?: ComponentType<{ className?: string }>
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
export function StatusPill({ variant = 'pending', label, icon: Icon, className }: StatusPillProps) {
  const style = STYLES[variant]
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-ds-border px-2 py-1',
        style.bg,
        className,
      )}
    >
      {Icon ? (
        <Icon className={cn('size-3 shrink-0', style.color)} />
      ) : (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-current',
            style.color,
            // 运行中状态附加脉冲动画；语义仍由文本标签承担，不只靠动效表达。
            variant === 'generating' && 'animate-pulse'
          )}
        />
      )}
      <span className={cn('text-[11px] font-medium', style.color)}>
        {label ?? style.defaultLabel}
      </span>
    </div>
  )
}
