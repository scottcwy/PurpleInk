import { ArrowLeft, Info } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { RouteStatus } from '@/app/_components/route-status'
import { buttonClassName } from '@/components/ui/button'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'
import { createMetadata } from '@/lib/metadata'

export const metadata: Metadata = createMetadata({
  title: '页面不存在',
  description: '请求的地址不存在或已失效。',
  path: '/',
  noIndex: true,
})

/**
 * 根级 404。承载两类情况：
 * 1. URL 未匹配任何路由；
 * 2. 路由内 `notFound()` 且该段没有更近的 not-found 边界。
 *
 * 文案刻意不区分「不存在」与「无权访问」，避免泄露其他 workspace
 * 中对象是否存在（docs/conventions/routing.md §9.2）。
 */
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="ds-app-gradient flex min-h-screen w-full flex-col items-center justify-center text-ds-text"
    >
      <RouteStatus
        icon={Info}
        title="页面不存在"
        description="这个地址没有对应的内容。链接可能已经失效，或输入有误。"
        actions={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/" className={buttonClassName({ variant: 'gray' })}>
              <ArrowLeft aria-hidden className="size-4 shrink-0" />
              返回首页
            </Link>
            <Link
              href={PRODUCTS_ROUTES.dashboard}
              className={buttonClassName({ variant: 'tinted' })}
            >
              打开工作台
            </Link>
          </div>
        }
      />
    </main>
  )
}
