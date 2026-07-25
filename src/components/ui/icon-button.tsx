import type { ButtonHTMLAttributes, ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ComponentType<{ className?: string }>
}

/**
 * 28×28 图标按钮原语（fill 底 + 16px 图标）。
 */
export function IconButton({ icon: Icon, className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-sm bg-fill text-label-secondary transition-colors hover:bg-fill-strong disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}
