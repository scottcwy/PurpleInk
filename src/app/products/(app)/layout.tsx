import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AppShell } from '@/features/navigation/app-shell'

/**
 * 应用路由组的共享壳。常驻侧栏在此挂载一次，切换 (app) 下的任意路由
 * 只替换右侧 children，侧栏 DOM 不重挂。/playbook 在组外，不带壳。
 *
 * 段级 `noIndex`：`/products/*` 全部需要登录，URL 里还带内部 projectId，
 * 不应进入搜索索引。子页面的 `createMetadata()` 不覆盖 `robots` 字段，
 * 因此在这一层声明即对整组生效（PLAN-002 §4.6）。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
