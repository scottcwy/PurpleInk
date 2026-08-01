import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { buttonClassName } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const ADMIN_SECTION_LINKS = [
  { href: '/admin', label: '概览' },
  { href: '/admin/jobs', label: '任务' },
  { href: '/admin/ops', label: '运维' },
  { href: '/admin/security', label: '安全' },
  { href: '/admin/ai', label: 'AI 审计' },
] as const

export function AdminPageFrame({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-7 sm:py-8">
      <Card className="flex flex-col gap-4 p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ds-text-muted">管理视图</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-ds-text-muted">{description}</p>
          </div>
          <Link
            href="/products/dashboard"
            className={buttonClassName({ variant: 'gray', size: 'sm' })}
          >
            <ArrowLeft aria-hidden className="size-4" />
            返回产品
          </Link>
        </header>
        <nav aria-label="管理视图分区" className="flex gap-2 overflow-x-auto pb-1">
          {ADMIN_SECTION_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={buttonClassName({ variant: 'gray', size: 'sm', className: 'shrink-0' })}
            >
              {item.label}
            </Link>
          ))}
          <span className="inline-flex min-h-10 shrink-0 items-center px-2 text-xs text-ds-text-muted">
            用户与计费 · 待接线
          </span>
        </nav>
      </Card>
      {children}
    </section>
  )
}
