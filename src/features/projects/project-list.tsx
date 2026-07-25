'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ProjectCard } from '@/components/ui/project-card'
import { SearchField } from '@/components/ui/search-field'

export interface ProjectSummary {
  id: string
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

export function ProjectList({
  projects,
}: {
  projects: readonly ProjectSummary[]
}) {
  const [query, setQuery] = useState('')
  const visibleProjects = useMemo(
    () => filterProjectSummaries(projects, query),
    [projects, query],
  )

  return (
    <>
      <SearchField
        aria-label="搜索项目"
        placeholder="搜索项目"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {visibleProjects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => (
            <Link key={project.id} href={project.href} className="w-fit max-w-full">
              <ProjectCard {...project} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="ds-dot-grid flex min-h-56 items-center justify-center rounded-lg border border-dashed border-ds-border text-sm text-ds-text-muted">
          没有匹配“{query.trim()}”的项目
        </div>
      )}
    </>
  )
}
