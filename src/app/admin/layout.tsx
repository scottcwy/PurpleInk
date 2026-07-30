import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdminSession } from '@/features/auth/page-session'
import { PurpleInkLogo } from '@/components/ui/purple-ink-logo'
import { AdminNav } from './admin-nav'

/**
 * 管理后台壳：常驻侧栏 + 右侧内容区，视觉沿用 ds 令牌与 AppShell 口径。
 *
 * 守卫分层（routing.md §9.2 admin 行）：proxy 做 cookie 形状拦截，这里查库
 * 校验会话并要求 role=admin——非 admin 静默 302 回产品首页。子页面中的
 * server page（概览）自己再包 requireAdminSession（RSC children 独立渲染），
 * 纯客户端页的数据全部经 withAdminSession 的 API（非 admin 一律 404）。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession('/admin')
  return (
    <div className="ds-app-gradient flex h-screen w-screen overflow-hidden text-ds-text">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ds-border bg-ds-surface/70 backdrop-blur-sm">
        <div className="px-5 pb-4 pt-6">
          <PurpleInkLogo />
          <div className="mt-1 text-[11px] font-medium text-ds-text-muted">管理后台</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <AdminNav />
        </div>
        <div className="border-t border-ds-border px-5 py-4">
          <div className="truncate text-[13px] font-medium">{session.name}</div>
          <div className="truncate text-[11px] text-ds-text-muted">{session.email}</div>
          <Link
            href="/products/dashboard"
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-ds-text-muted transition-colors hover:text-ds-text"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回产品
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  )
}
