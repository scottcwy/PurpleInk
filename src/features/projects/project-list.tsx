'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { ProjectCard } from '@/components/ui/project-card'
import { SearchField } from '@/components/ui/search-field'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'

export interface ProjectSummary {
  id: string
  kind: ProjectWorkflowKind
  title: string
  href: string
  meta: string
  status: 'pending' | 'generating' | 'rendered' | 'cached' | 'failed'
}

export function filterProjectSummaries(
  projects: readonly ProjectSummary[],
  query: string,
): ProjectSummary[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...projects]
  return projects.filter((project) =>
    project.title.toLocaleLowerCase().includes(normalized),
  )
}

export function groupProjectSummaries(projects: readonly ProjectSummary[]) {
  return {
    authored: projects.filter((project) => project.kind !== 'website'),
    websites: projects.filter((project) => project.kind === 'website'),
  }
}

export function ProjectList({
  projects,
  authoredEmptyAction,
  websiteEmptyAction,
}: {
  projects: readonly ProjectSummary[]
  authoredEmptyAction?: ReactNode
  websiteEmptyAction?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const visibleProjects = useMemo(
    () => filterProjectSummaries(projects, query),
    [projects, query],
  )
  const groups = groupProjectSummaries(visibleProjects)
  const hasQuery = query.trim().length > 0

  return (
    <div className="flex flex-col gap-5">
      <SearchField
        aria-label="搜索项目"
        placeholder="搜索全部项目"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ProjectSection
          title="文稿与录音转视频"
          description="沿用主工作流；录音项目使用原声时间轴，不重复配音。"
          projects={groups.authored}
          emptyLabel={
            hasQuery
              ? `没有匹配“${query.trim()}”的文稿或录音项目`
              : '还没有文稿或录音项目'
          }
          emptyAction={hasQuery ? undefined : authoredEmptyAction}
        />
        <ProjectSection
          title="网站介绍视频"
          description="Playwright 采集与成熟生视频引擎，统一挂载到项目画布。"
          projects={groups.websites}
          emptyLabel={
            hasQuery
              ? `没有匹配“${query.trim()}”的网站项目`
              : '还没有网站介绍项目'
          }
          emptyAction={hasQuery ? undefined : websiteEmptyAction}
        />
      </div>
    </div>
  )
}

function ProjectSection({
  title,
  description,
  projects,
  emptyLabel,
  emptyAction,
}: {
  title: string
  description: string
  projects: readonly ProjectSummary[]
  emptyLabel: string
  emptyAction?: ReactNode
}) {
  return (
    <section className="min-w-0 rounded-xl border border-ds-border bg-ds-surface p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-ds-text">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-ds-text-muted">{description}</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-ds-text-muted">
          {projects.length}
        </span>
      </div>
      {projects.length > 0 ? (
        <div className="grid gap-4">
          {projects.map((project) => (
            <Link key={project.id} href={project.href} className="block min-w-0">
              <ProjectCard {...project} className="w-full" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="ds-dot-grid flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ds-border px-5 text-center">
          <p className="text-sm text-ds-text-muted">{emptyLabel}</p>
          {emptyAction}
        </div>
      )}
    </section>
  )
}
