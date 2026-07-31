'use client'

import { CircleSlash } from 'lucide-react'
import Link from 'next/link'
import { buttonClassName } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'

export interface MobileFallbackCardProps {
  title?: string
  description?: string
}

/**
 * 移动端显式降级卡：画布 DAG 编辑器在窄视口下交互物理不可达，
 * 按「未接线/不可用状态必须显式展示」约定直接告知，不渲染假数据。
 * 状态语义由文本 + 图标共同表达（图标取白名单内语义最近的 circle-slash）。
 */
export function MobileFallbackCard({
  title = '画布编辑需要桌面端',
  description = '请在宽度 ≥ 900px 的设备上打开此页面',
}: MobileFallbackCardProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-ds-canvas p-6 text-ds-text">
      <EmptyState
        icon={CircleSlash}
        title={title}
        description={description}
        action={
          <Link
            href={PRODUCTS_ROUTES.projects}
            className={buttonClassName({ variant: 'tinted', className: 'h-10' })}
          >
            返回项目列表
          </Link>
        }
        className="rounded-lg border border-ds-border bg-ds-surface"
      />
    </div>
  )
}
