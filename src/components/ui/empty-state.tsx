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
      <Icon className="h-12 w-12 text-label-tertiary" />
      <h3 className="text-[17px] font-semibold font-sc text-label-secondary">{title}</h3>
      {description && (
        <p className="text-[13px] font-sc text-label-tertiary">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}
