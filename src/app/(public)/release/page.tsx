import type { Metadata } from 'next'
import { RouteShellPage } from '@/app/_components/route-shell-page'
import { createMetadata } from '@/lib/metadata'

export const metadata: Metadata = createMetadata({
  title: '发布',
  description: 'PurpleInk 未来的产品发布制作入口。',
  path: '/release',
  noIndex: true,
})

/**
 * `/release` 占位（L1）。
 *
 * 只允许单页。禁止提前落 `/release/[releaseId]/*` 子路由、多步导航或
 * 禁用按钮矩阵——占位的成本必须接近零，否则它会再次长成需要维护的
 * 第二套壳（docs/conventions/routing.md §10）。
 */
export default function ReleasePage() {
  return (
    <RouteShellPage
      title="发布"
      meta="规划中的路由"
      description="未来在这里为一次产品上线组织发布内容，并把已批准的产品事实交给制作流程。当前不展示任何发布记录、阶段或审批状态。"
      sources={['Product', 'Release', 'Artifact']}
      futureGuard="需要先完成认证与 Workspace 归属校验。"
    />
  )
}
