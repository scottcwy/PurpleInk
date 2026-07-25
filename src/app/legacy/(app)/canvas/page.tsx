import { Clapperboard } from 'lucide-react'
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
  searchParams: Promise<{ projectId?: string }>
}

export default async function CanvasPage({ searchParams }: CanvasPageProps) {
  const requestedProjectId = (await searchParams).projectId
  const projects = await listProjects()
  const projectId = requestedProjectId ?? projects[0]?.id
  if (!projectId) return <CanvasEmptyState description="请先创建一个项目，再进入节点画布。" />

  const graph = await getCanvasGraph(projectId)
  if (graph.nodes.length === 0) {
    return <CanvasEmptyState projectId={projectId} description="当前项目还没有节点，请先导入并拆分脚本。" />
  }

  const positions = computeLayout(graph.nodes, graph.edges)
  const nodes = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }))

  const projectTitle = projects.find(({ id }) => id === projectId)?.title ?? 'RAG 十分钟入门'
  return (
    <CanvasLoader
      projectId={projectId}
      projectTitle={projectTitle}
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
