import type { ReactNode } from 'react'

/**
 * 公开只读壳（L1）。
 *
 * 承载 `/release` 占位，以及未来的 `/artifacts`、`/share/[shareId]`。
 * 不挂 `AppSidebar`，不提供任何写操作入口：这一层可能被未登录访问者
 * 或分享链接的接收方打开（docs/conventions/routing.md §1、§8.5）。
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ds-app-gradient flex min-h-screen flex-col text-ds-text">
      <div id="main-content" className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
