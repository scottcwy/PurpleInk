import Link from 'next/link'
import { ArrowRight, FolderKanban, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RecentProject {
  id: string
  title: string
  href: string
  meta: string
  updatedAt: Date
  shotCount: number
}

export function RecentProjectsPanel({
  projects = [],
  className,
}: {
  projects?: readonly RecentProject[]
  className?: string
}) {
  return (
    <section className={cn('flex min-h-[285px] flex-col gap-3 text-ds-text', className)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-semibold tracking-tight">最近项目</h2>
            <span className="font-mono text-xs text-ds-text-muted">
              {projects.length} 个可见
            </span>
          </div>
          <p className="mt-1 text-xs text-ds-text-muted">
            打开最近更新的真实项目画布。
          </p>
        </div>
        <Link
          href="/products/projects"
          className="flex items-center gap-1.5 text-xs text-ds-text-muted hover:text-ds-text"
        >
          查看全部
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>
      {projects.length > 0 ? (
        <div className="grid flex-1 grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={project.href}
              className="min-w-0 overflow-hidden rounded-lg border border-ds-border bg-ds-surface transition-colors hover:border-ds-primary/40"
            >
              <article>
                <div className="flex aspect-video items-center justify-center bg-ds-surface-muted">
                  <Play aria-hidden className="size-7 text-ds-text-muted" />
                </div>
                <div className="p-3.5">
                  <h3 className="truncate text-sm font-semibold">{project.title}</h3>
                  <p className="mt-1.5 text-xs text-ds-text-muted">{project.meta}</p>
                </div>
              </article>
            </Link>
          ))}
        </div>
      ) : (
        <div className="ds-dot-grid flex flex-1 items-center justify-center rounded-lg border border-dashed border-ds-border">
          <div className="max-w-sm px-6 py-10 text-center">
            <FolderKanban aria-hidden className="mx-auto size-7 text-ds-text-muted" />
            <p className="mt-3 text-sm font-semibold">暂无可展示的项目</p>
            <p className="mt-1 text-xs leading-5 text-ds-text-muted">
              使用顶栏「新建项目」创建后，最近更新会显示在这里。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
