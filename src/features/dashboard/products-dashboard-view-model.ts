import type { CanvasGraph, Project } from '@/features/canvas'
import { productCanvasHref } from '@/features/navigation/products-routes'

export interface ProductsDashboardMetric {
  label: string
  value: string
  source: string
}

export interface ProductsStatusDistribution {
  running: number
  failed: number
  succeeded: number
  idle: number
}

export interface ProductsRecentProject {
  id: string
  title: string
  href: string
  meta: string
  updatedAt: Date
  shotCount: number
}

export interface ProductsDashboardView {
  metrics: ProductsDashboardMetric[]
  statusDistribution: ProductsStatusDistribution
  recentProjects: ProductsRecentProject[]
  updatedLabel: string
}

export function buildProductsDashboardView(
  projects: readonly Project[],
  graphs: ReadonlyMap<string, CanvasGraph>,
): ProductsDashboardView {
  const sortedProjects = [...projects].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  )
  const artifactIds = new Set<string>()
  const statusDistribution: ProductsStatusDistribution = {
    running: 0,
    failed: 0,
    succeeded: 0,
    idle: 0,
  }
  let activePipelines = 0
  let shotCount = 0

  const recentProjects = sortedProjects.map((project) => {
    const graph = graphs.get(project.id) ?? { nodes: [], edges: [] }
    const projectShotCount = graph.nodes.filter(
      (node) => node.type === 'shot-codegen',
    ).length
    shotCount += projectShotCount
    for (const node of graph.nodes) {
      for (const artifact of node.artifacts) artifactIds.add(artifact.id)
    }
    const status = projectStatus(graph)
    statusDistribution[status] += 1
    if (status === 'running') activePipelines += 1
    return {
      id: project.id,
      title: project.title,
      href: productCanvasHref(project.id),
      meta: `${projectShotCount} 个镜头 · ${project.updatedAt.toLocaleString('zh-CN')}`,
      updatedAt: project.updatedAt,
      shotCount: projectShotCount,
    }
  })

  const averageShots =
    projects.length === 0
      ? '—'
      : (shotCount / projects.length).toFixed(1).replace(/\.0$/, '')

  return {
    metrics: [
      {
        label: '项目总数',
        value: String(projects.length),
        source: 'projects.total',
      },
      {
        label: '活跃 Pipeline',
        value: String(activePipelines),
        source: 'pipelines.active',
      },
      {
        label: '已提交 Artifact',
        value: String(artifactIds.size),
        source: 'artifacts.committed',
      },
      {
        label: '平均镜头数',
        value: averageShots,
        source: 'shots.average',
      },
    ],
    statusDistribution,
    recentProjects,
    updatedLabel: sortedProjects[0]
      ? `更新于 ${sortedProjects[0].updatedAt.toLocaleString('zh-CN')}`
      : '暂无项目快照',
  }
}

function projectStatus(
  graph: CanvasGraph,
): keyof ProductsStatusDistribution {
  if (graph.nodes.some((node) => node.status === 'failed')) return 'failed'
  if (
    graph.nodes.some(
      (node) => node.status === 'pending' || node.status === 'running',
    )
  ) {
    return 'running'
  }
  if (
    graph.nodes.length > 0 &&
    graph.nodes.every((node) => node.status === 'success')
  ) {
    return 'succeeded'
  }
  return 'idle'
}
