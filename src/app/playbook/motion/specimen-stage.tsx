'use client'

import type { ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 动效标本的共享舞台原语。
 *
 * 所有标本共用同一尺寸的 Stage，使不同意图之间可直接目视比较；
 * 触发控件共用 PILL，避免每个标本各写一套按钮视觉。
 */

/** 标本舞台：固定高度 + overflow-hidden，保证基线截图可复现。 */
export const STAGE_CLASS =
  'bg-ds-surface-muted border-ds-border relative h-24 overflow-hidden rounded-md border'

/** 标本触发控件。本身即意图 1/3（hover 换底 + focus ring）的示例。 */
export const PILL_CLASS =
  'border-ds-border bg-ds-surface hover:bg-ds-surface-muted rounded-md border px-2.5 py-1 text-[11px] font-medium duration-fast ease-standard transition-colors focus-visible:ring-ds-ring focus-visible:ring-2 focus-visible:outline-none'

export function Stage({ children }: { children: ReactNode }) {
  return <div className={STAGE_CLASS}>{children}</div>
}

/** 舞台内的左下角注解，用于说明操作方式或语义兜底。 */
export function StageNote({ children }: { children: ReactNode }) {
  return (
    <span className="text-ds-text-muted absolute bottom-1 left-2 text-[10px]">
      {children}
    </span>
  )
}

export function Toggle({
  on,
  onToggle,
  onLabel,
  offLabel,
}: {
  on: boolean
  onToggle: () => void
  onLabel: string
  offLabel: string
}) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} className={PILL_CLASS}>
      {on ? onLabel : offLabel}
    </button>
  )
}

/** 一次性动画的重播触发器（进场类标本没有稳定的「关」态）。 */
export function Replay({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(PILL_CLASS, 'inline-flex items-center gap-1')}
    >
      <RotateCcw className="size-3" aria-hidden />
      重播
    </button>
  )
}
