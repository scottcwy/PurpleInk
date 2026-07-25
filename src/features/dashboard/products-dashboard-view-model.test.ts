import { describe, expect, it } from 'vitest'
import type { CanvasGraph, CanvasGraphNode, Project } from '@/features/canvas'
import { buildProductsDashboardView } from './products-dashboard-view-model'

describe('buildProductsDashboardView', () => {
  it('derives truthful metrics, statuses, and recent projects', () => {
    const projects = [
      project('project-old', '旧项目', '2026-07-20T10:00:00.000Z'),
      project('project-new', '新项目', '2026-07-25T10:00:00.000Z'),
    ]
    const graphs = new Map<string, CanvasGraph>([
      [
        'project-old',
        graph([
          node('old-shot-1', 'shot-codegen', 'failed', ['artifact-c']),
          node('old-shot-2', 'shot-codegen', 'success'),
        ]),
      ],
      [
        'project-new',
        graph([
          node('new-shot', 'shot-codegen', 'running', ['artifact-a']),
          node('new-qa', 'shot-qa', 'success', [
            'artifact-a',
            'artifact-b',
          ]),
        ]),
      ],
    ])

    const view = buildProductsDashboardView(projects, graphs)

    expect(view.metrics.map(({ value }) => value)).toEqual([
      '2',
      '1',
      '3',
      '1.5',
    ])
    expect(view.statusDistribution).toEqual({
      running: 1,
      failed: 1,
      succeeded: 0,
      idle: 0,
    })
    expect(view.recentProjects.map(({ id, href }) => ({ id, href }))).toEqual([
      {
        id: 'project-new',
        href: '/products/canvas/project-new',
      },
      {
        id: 'project-old',
        href: '/products/canvas/project-old',
      },
    ])
  })

  it('keeps empty metrics truthful when there are no projects', () => {
    const view = buildProductsDashboardView([], new Map())

    expect(view.metrics.map(({ value }) => value)).toEqual([
      '0',
      '0',
      '0',
      '—',
    ])
    expect(view.recentProjects).toEqual([])
    expect(view.updatedLabel).toBe('暂无项目快照')
  })
})

function project(id: string, title: string, updatedAt: string): Project {
  return {
    id,
    title,
    script: '',
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
  }
}

function graph(nodes: CanvasGraphNode[]): CanvasGraph {
  return { nodes, edges: [] }
}

function node(
  id: string,
  type: CanvasGraphNode['type'],
  status: CanvasGraphNode['status'],
  artifactIds: string[] = [],
): CanvasGraphNode {
  return {
    id,
    type,
    status,
    stage: null,
    contentHash: null,
    data: {},
    position: { x: 0, y: 0 },
    laneKey: type === 'shot-codegen' ? id : null,
    laneRole: null,
    artifacts: artifactIds.map((artifactId) => ({
      id: artifactId,
      kind: 'render-mp4',
      filename: `${artifactId}.mp4`,
    })),
  }
}
