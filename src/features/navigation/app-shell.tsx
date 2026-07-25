import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { AppSidebar } from './app-sidebar'
import { AppSidebarShell } from './app-sidebar-shell'
import { NavContextProvider } from './nav-context'
import type { AppSection } from './types'

export type { AppSection }
export { AppSidebar }

export interface AppShellProps {
  children: ReactNode
  className?: string
}

/**
 * 常驻应用壳。由 `src/app/(app)/layout.tsx` 挂载一次：
 * 侧栏跨路由不重挂，切页仅右侧内容变化。
 *
 * - `NavContextProvider` 同时包裹侧栏与页面内容：页面（后代）发布服务端
 *   可信的 `{ projectId, rendererNodeId }`，侧栏（后代）读取它构造深链。
 * - 侧栏 active/响应式/可调宽等交互全部下沉到 `AppSidebarShell`，
 *   由 `usePathname()` 自行推导激活项，页面不再传 active。
 * - 内容区只给一个 `flex-1` 容器；各页在自身根元素上决定滚动/全高布局。
 */
export function AppShell({ children, className }: AppShellProps) {
  return (
    <NavContextProvider>
      <div className={cn('flex h-screen w-screen overflow-hidden bg-bg text-label', className)}>
        <AppSidebarShell />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </NavContextProvider>
  )
}
