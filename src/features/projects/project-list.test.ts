import { describe, expect, it } from 'vitest'
import {
  filterProjectSummaries,
  groupProjectSummaries,
  type ProjectSummary,
} from './project-list'

const PROJECTS: ProjectSummary[] = [
  {
    id: '1',
    kind: 'script',
    title: 'RAG 十分钟入门',
    href: '/products/canvas/1',
    meta: '6 个镜头',
    status: 'rendered',
  },
  {
    id: '2',
    kind: 'audio',
    title: 'Agent Runtime',
    href: '/products/canvas/2',
    meta: '2 个镜头',
    status: 'pending',
  },
  {
    id: '3',
    kind: 'website',
    title: 'PurpleInk Website',
    href: '/products/canvas/3',
    meta: '网站介绍',
    status: 'generating',
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

  it('groups script and audio on the left and websites on the right', () => {
    expect(groupProjectSummaries(PROJECTS)).toEqual({
      authored: [PROJECTS[0], PROJECTS[1]],
      websites: [PROJECTS[2]],
    })
  })
})
