'use client'

import { CircleX, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { RouteStatus } from '@/app/_components/route-status'
import { Button, buttonClassName } from '@/components/ui/button'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'

/**
 * 制作应用段级错误边界。落在 `(app)/layout.tsx` 内，侧栏保留。
 *
 * 只展示错误类别与 `digest` 指纹：原始 message、堆栈、provider 响应
 * 可能带上凭据或内部标识，一律不渲染（design-system-inventory §7）。
 * 完整错误留在服务端日志，按 digest 对账。
 */
export default function ProductsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <RouteStatus
        role="alert"
        icon={CircleX}
        title="页面加载失败"
        description="这一步没有完成。可以直接重试；若持续失败，请把下面的参考号一起反馈。"
        reference={error.digest}
        actions={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href={PRODUCTS_ROUTES.dashboard}
              className={buttonClassName({ variant: 'gray' })}
            >
              返回工作台
            </Link>
            <Button variant="tinted" icon={RefreshCw} onClick={reset}>
              重试
            </Button>
          </div>
        }
      />
    </main>
  )
}
