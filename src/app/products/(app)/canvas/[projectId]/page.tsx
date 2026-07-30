import { Clapperboard } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import { withPageSession } from '@/features/auth/page-session'
import { getBillingProjection } from '@/features/billing'
import { getWorkspaceConcurrencyProjection } from '@/features/ai/workspace-concurrency-projection'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import {
  computeLayout,
  getCanvasGraph,
  getProjectAutopilot,
  listProjects,
  type PositionedCanvasNode,
} from '@/features/canvas'
import { getProjectRouteState } from '@/features/projects/project-compatibility'
import { PublishNavContext } from '@/features/navigation/nav-context'
import { CanvasLoader } from './canvas-loader'
import { UnsupportedProjectNotice } from '@/features/canvas/unsupported-project-notice'

export const dynamic = 'force-dynamic'

interface CanvasPageProps {
  params: Promise<{ projectId: string }>
}

export default async function CanvasPage({ params }: CanvasPageProps) {
  const { projectId } = await params
  return withPageSession(`/products/canvas/${projectId}`, () =>
    renderCanvas(projectId),
  )
}

async function renderCanvas(projectId: string) {
  const routeState = await getProjectRouteState(projectId)
  if (routeState === 'missing') notFound()
  if (routeState === 'legacy') return <UnsupportedProjectNotice />
  const projects = await listProjects()
  const project = projects.find((candidate) => candidate.id === projectId)
  if (!project) notFound()

  const [graph, billing, concurrency] = await Promise.all([
    getCanvasGraph(projectId),
    getBillingProjection(),
    getWorkspaceConcurrencyProjection(),
  ])
  const billingProjection: BillingUiProjection = billing
  if (graph.nodes.length === 0) {
    return <CanvasEmptyState projectId={projectId} description="当前项目还没有节点，请先导入并拆分脚本。" />
  }

  const positions = computeLayout(graph.nodes, graph.edges)
  const nodes: PositionedCanvasNode[] = graph.nodes.map((node) => {
    const position = positions.get(node.id)
    if (!position) throw new Error(`布局未能定位节点：${node.id}`)
    return { ...node, position }
  })

  return (
    <CanvasLoader
      projectId={projectId}
      projectTitle={project.title}
      autopilot={await getProjectAutopilot(projectId)}
      billing={billingProjection}
      concurrency={concurrency}
      nodes={nodes}
      edges={graph.edges}
    />
  )
}

function CanvasEmptyState({ description, projectId }: { description: string; projectId?: string }) {
  return (
    <>
      <PublishNavContext projectId={projectId} />
      <main className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState icon={Clapperboard} title="画布尚未生成" description={description} />
      </main>
    </>
  )
}
