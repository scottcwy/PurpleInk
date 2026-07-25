import { FolderKanban, Info } from 'lucide-react'
import Link from 'next/link'
import { RouteStatus } from '@/app/_components/route-status'
import { buttonClassName } from '@/components/ui/button'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'

/**
 * 制作应用段级 404。落在 `(app)/layout.tsx` 内，因此常驻侧栏保留，
 * 用户不会被踢出应用壳（docs/conventions/routing.md §1、§9.2）。
 *
 * 触发来源是各页显式的 `notFound()`：项目不存在、镜头不属于该项目、
 * 节点类型不是 `shot-codegen`、`projectId` 缺失。四种情况共用一套文案，
 * 不回显具体哪一项失配。
 */
export default function ProductsNotFound() {
  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <RouteStatus
        icon={Info}
        title="未找到该资源"
        description="链接里的项目、镜头或产物不可用。它可能已被删除，或地址中的 ID 无效。"
        actions={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href={PRODUCTS_ROUTES.dashboard}
              className={buttonClassName({ variant: 'gray' })}
            >
              返回工作台
            </Link>
            <Link
              href={PRODUCTS_ROUTES.projects}
              className={buttonClassName({ variant: 'tinted' })}
            >
              <FolderKanban aria-hidden className="size-4 shrink-0" />
              查看项目
            </Link>
          </div>
        }
      />
    </main>
  )
}
