import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PurpleInkLogo } from '@/components/ui/purple-ink-logo'

const ADMIN_NAV_ITEMS = [
  { href: '/admin', label: '概览' },
  { href: '/admin/users', label: '用户', planned: true },
  { href: '/admin/jobs', label: '任务' },
  { href: '/admin/ops', label: '运维' },
  { href: '/admin/security', label: '安全' },
  { href: '/admin/billing', label: '计费', planned: true },
  { href: '/admin/ai', label: 'AI 审计' },
] as const

export function AdminShell({
  children,
  account,
}: {
  children: ReactNode
  account: { name: string; email: string }
}) {
  return (
    <div className="ds-app-gradient min-h-screen text-ds-text">
      <header className="sticky top-0 z-20 border-b border-ds-border bg-ds-surface/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-7">
          <Link href="/admin" className="shrink-0" aria-label="管理后台首页">
            <PurpleInkLogo className="scale-90 origin-left" />
          </Link>
          <span className="shrink-0 text-xs font-medium text-ds-text-muted">管理后台</span>
          <nav
            aria-label="管理后台导航"
            className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1 sm:justify-center"
          >
            {ADMIN_NAV_ITEMS.map((item) => (
              'planned' in item && item.planned ? (
                <span
                  key={item.href}
                  aria-disabled="true"
                  title="账号与计费管理将在下一集成批次接线"
                  className="inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium text-ds-text-muted opacity-55"
                >
                  {item.label} · 待接线
                </span>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium text-ds-text-muted transition-[background-color,color] duration-fast ease-standard hover:bg-ds-surface-muted hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring"
                >
                  {item.label}
                </Link>
              )
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="hidden min-w-0 text-right lg:block">
              <span className="block truncate text-xs font-medium">{account.name}</span>
              <span className="block truncate text-[11px] text-ds-text-muted">{account.email}</span>
            </span>
            <Link
              href="/products/dashboard"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-xs text-ds-text-muted transition-[background-color,color] duration-fast ease-standard hover:bg-ds-surface-muted hover:text-ds-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring"
            >
              <ArrowLeft aria-hidden className="size-4" />
              返回产品
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-7 sm:py-8">{children}</main>
    </div>
  )
}

export function AdminPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-ds-text-muted">{description}</p>
    </header>
  )
}
