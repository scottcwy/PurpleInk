import type { ReactNode } from 'react'
import { AppShell } from '@/features/navigation/app-shell'

/**
 * 应用路由组的共享壳。常驻侧栏在此挂载一次，切换 (app) 下的任意路由
 * 只替换右侧 children，侧栏 DOM 不重挂。/playbook 在组外，不带壳。
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
