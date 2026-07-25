import type { ReactNode } from 'react'

/**
 * 认证壳（L2）。
 *
 * 不挂 `AppSidebar`：登录、注册发生在进入应用之前，此时还没有 workspace
 * 上下文，导航项无法有意义地启用（docs/conventions/routing.md §1）。
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ds-app-gradient flex min-h-screen flex-col text-ds-text">
      <div id="main-content" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
