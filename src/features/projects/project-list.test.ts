import { describe, expect, it } from 'vitest'
import { filterProjectSummaries, type ProjectSummary } from './project-list'

const PROJECTS: ProjectSummary[] = [
  {
    id: '1',
    title: 'RAG 十分钟入门',
    href: '/products/canvas/1',
    meta: '6 个镜头',
    status: 'rendered',
  },
  {
    id: '2',
    title: 'Agent Runtime',
    href: '/products/canvas/2',
    meta: '2 个镜头',
    status: 'pending',
  },
]

describe('filterProjectSummaries', () => {
  it('matches Chinese titles and latin text without case sensitivity', () => {
    expect(filterProjectSummaries(PROJECTS, '十分钟')).toEqual([PROJECTS[0]])
    expect(filterProjectSummaries(PROJECTS, 'agent')).toEqual([PROJECTS[1]])
  })

  it('returns all projects for an empty query', () => {
    expect(filterProjectSummaries(PROJECTS, '  ')).toEqual(PROJECTS)
  })
})
