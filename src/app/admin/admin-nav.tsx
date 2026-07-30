'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Film,
  LayoutDashboard,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** 侧栏项与 §9 守卫矩阵的 /admin 四页一一对应；激活态由路径推导。 */
const NAV_ITEMS = [
  { href: '/admin', label: '概览', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: '用户管理', icon: ShieldCheck, exact: false },
  { href: '/admin/jobs', label: '任务监控', icon: Film, exact: false },
  { href: '/admin/ops', label: '系统运维', icon: Settings, exact: false },
] as const

export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav className="flex flex-col gap-1" aria-label="管理后台导航">
      {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-ds-blue-soft text-ds-blue'
                : 'text-ds-text-muted hover:bg-ds-surface-muted hover:text-ds-text',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
