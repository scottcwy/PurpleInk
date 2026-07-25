import { Clapperboard } from 'lucide-react'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/ui/empty-state'
import {
  computeLayout,
  getCanvasGraph,
  getProjectAutopilot,
  listProjects,
} from '@/features/canvas'
import { PublishNavContext } from '@/features/navigation/nav-context'
import { CanvasLoader } from './canvas-loader'

export const dynamic = 'force-dynamic'

interface CanvasPageProps {
  params: Promise<{ projectId: string }>
}

export default async function CanvasPage({ params }: CanvasPageProps) {
  const { projectId } = await params
  const projects = await listProjects()
  const project = projects.find((candidate) => candidate.id === projectId)
  if (!project) notFound()

  const graph = await getCanvasGraph(projectId)
  if (graph.nodes.length === 0) {
    return <CanvasEmptyState projectId={projectId} description="当前项目还没有节点，请先导入并拆分脚本。" />
  }

  const positions = computeLayout(graph.nodes, graph.edges)
  const nodes = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))

  return (
    <CanvasLoader
      projectId={projectId}
      projectTitle={project.title}
      autopilot={await getProjectAutopilot(projectId)}
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
