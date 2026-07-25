import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

/**
 * 空状态（SSOT）。
 * canvas.pen: 320 宽、垂直居中、gap-3、p-10；48px 图标 + 标题 + 描述 + 操作按钮。
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex w-80 flex-col items-center gap-3 px-10 py-10 text-center',
        className,
      )}
    >
      <Icon className="h-12 w-12 text-ds-text-muted" />
      <h3 className="text-[17px] font-semibold text-ds-text-muted">{title}</h3>
      {description && (
        <p className="text-[13px] text-ds-text-muted">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}
