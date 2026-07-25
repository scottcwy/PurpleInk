import type { ComponentType, ReactNode } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

export interface RouteStatusProps {
  /** Lucide 图标，取自 design-system-inventory §9 白名单。 */
  icon: ComponentType<{ className?: string }>
  title: string
  description: ReactNode
  /**
   * 稳定的错误指纹（Next 的 `error.digest`）。
   * 只用于让用户回报问题，不携带原始错误文本、堆栈或 provider 响应。
   */
  reference?: string
  actions?: ReactNode
  /** 失败态传 `alert`，让读屏软件立即播报。 */
  role?: 'alert'
  className?: string
}

/**
 * 路由级状态面板（C 层组合）。
 *
 * 404 与错误边界共用同一个表面：只组合已登记的 `EmptyState` 与 `Button`，
 * 不引入平行的空状态或卡片视觉。状态语义由图标加标题文本共同表达，
 * 不依赖色相（design-system-inventory §3.3、§8）。
 */
export function RouteStatus({
  icon,
  title,
  description,
  reference,
  actions,
  role,
  className,
}: RouteStatusProps) {
  return (
    <div
      role={role}
      className={cn(
        'flex w-full flex-1 items-center justify-center p-6',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <EmptyState
          icon={icon}
          title={title}
          description={description}
          action={actions}
        />
        {reference ? (
          <p className="font-mono text-[11px] text-ds-text-muted">
            <span className="sr-only">错误参考号：</span>
            {reference}
          </p>
        ) : null}
      </div>
    </div>
  )
}
