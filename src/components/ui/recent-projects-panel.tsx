import Link from 'next/link'
import { ArrowRight, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RecentProject {
  id: string
  title: string
  meta: string
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
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold">最近项目</h2>
          <span className="font-mono text-[10px] text-ds-text-muted">
            {projects.length} 个可见
          </span>
        </div>
        <Link
          href="/products"
          className="flex items-center gap-1.5 text-[11px] text-ds-text-muted hover:text-ds-text"
        >
          查看全部
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>
      {projects.length > 0 ? (
        <div className="grid flex-1 gap-3.5 md:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="overflow-hidden rounded-lg border border-ds-border bg-ds-surface"
            >
              <div className="flex h-[150px] items-center justify-center bg-ds-surface-muted">
                <Play aria-hidden className="size-7 text-ds-text-muted" />
              </div>
              <div className="p-4">
                <h3 className="text-[15px] font-semibold">{project.title}</h3>
                <p className="mt-2 text-xs text-ds-text-muted">{project.meta}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="ds-dot-grid flex flex-1 items-center justify-center rounded-lg border border-dashed border-ds-border">
          <div className="max-w-sm px-6 text-center">
            <Play aria-hidden className="mx-auto size-7 text-ds-text-muted" />
            <p className="mt-3 text-sm font-semibold">暂无可展示的真实项目</p>
            <p className="mt-1 text-xs leading-5 text-ds-text-muted">
              该区域将在 Stage B 读取 Product、Release 与 Artifact 投影。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
