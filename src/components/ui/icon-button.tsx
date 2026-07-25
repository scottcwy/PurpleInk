import type { ButtonHTMLAttributes, ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ComponentType<{ className?: string }>
}

/**
 * 32×32 Canonical 图标按钮（ds-surface 底 + 16px 图标）。
 */
export function IconButton({ icon: Icon, className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md border border-ds-border bg-ds-surface text-ds-text-muted transition-colors hover:bg-ds-surface-muted hover:text-ds-text disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}
