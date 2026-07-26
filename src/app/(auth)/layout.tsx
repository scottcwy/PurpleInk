import Link from 'next/link'
import type { ReactNode } from 'react'
import { PurpleInkLogo } from '@/components/ui/purple-ink-logo'
import { AuthPoster } from './_components/auth-poster'

/**
 * 认证壳（L2）。
 *
 * 不挂 `AppSidebar`：登录、注册发生在进入应用之前，此时还没有 workspace
 * 上下文，导航项无法有意义地启用（docs/conventions/routing.md §1）。
 * 也不挂营销侧 `MarketingProviders` / Lenis（routing.md §1 的滚动分层）。
 *
 * 视觉归属是**应用侧 `ds-*`**，不是营销侧 token（决策见
 * docs/designs/Design-system-inventory.md 的登录页条目）。这不牺牲「与落地页
 * 连续」：`--ds-gradient-start` 在浅色是 `#ffffff`、深色是 `#03040a`，与营销侧
 * `--background` 数值相同，右栏顶部与落地页首屏无缝；同时右栏能直接复用
 * `components/ui/*` 的控件，不必覆盖组件内部 token 或另造一套输入框。
 *
 * 版式：`lg` 及以上左右各半屏，左栏海报通栏铺满视口高度并独立不滚动；
 * 移动端单栏，海报折叠（实测流量口径见 `_components/auth-poster.tsx`）。
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ds-app-gradient min-h-screen text-ds-text lg:grid lg:h-screen lg:grid-cols-2 lg:overflow-hidden">
      <aside className="hidden lg:block lg:h-screen" aria-hidden="true">
        <AuthPoster />
      </aside>
      <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0 lg:overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-6 sm:px-10">
          <Link href="/" className="focus-ring rounded-md" aria-label="返回 PurpleInk 首页">
            <PurpleInkLogo />
          </Link>
          <Link
            href="/"
            className="focus-ring rounded-md px-2 py-1 text-sm text-ds-text-muted underline-offset-4 hover:text-ds-text hover:underline"
          >
            返回首页
          </Link>
        </header>
        <main
          id="main-content"
          className="flex flex-1 flex-col justify-center px-6 pb-12 sm:px-10"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
