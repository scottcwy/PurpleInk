import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { optionalSession } from '@/features/auth/page-session'
import { AppShell } from '@/features/navigation/app-shell'

/**
 * 应用路由组的共享壳。常驻侧栏在此挂载一次，切换 (app) 下的任意路由
 * 只替换右侧 children，侧栏 DOM 不重挂。/playbook 在组外，不带壳。
 *
 * 这里读会话**只为侧栏展示真实账户**（姓名/邮箱/workspace），不承担守卫：
 * 守卫必须由各 page 自己包 `withPageSession`（RSC children 独立渲染，
 * layout 的 AsyncLocalStorage 不传播）。会话为 null 的边缘态（残留失效
 * cookie）下页面会 302 走，侧栏短暂显示「未登录」占位而非假名字。
 *
 * 段级 `noIndex`：`/products/*` 全部需要登录，URL 里还带内部 projectId，
 * 不应进入搜索索引。子页面的 `createMetadata()` 不覆盖 `robots` 字段，
 * 因此在这一层声明即对整组生效（PLAN-002 §4.6）。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await optionalSession()
  return (
    <AppShell
      account={
        session
          ? {
              name: session.name,
              email: session.email,
              workspaceName: session.workspaceName,
            }
          : null
      }
    >
      {children}
    </AppShell>
  )
}
