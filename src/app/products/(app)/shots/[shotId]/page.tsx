import { notFound } from 'next/navigation'
import { getLatestArtifact } from '@/features/artifacts'
import { withPageSession } from '@/features/auth/page-session'
import {
  getCanvasGraph,
  listProjects,
  type CanvasGraphNode,
} from '@/features/canvas'
import { getProjectRouteState } from '@/features/projects/project-compatibility'
import { UnsupportedProjectNotice } from '@/features/canvas/unsupported-project-notice'
import { ShotDetail } from './shot-detail'
import { resolveCompositionMode, resolveRenderSpec } from './shot-server-data'

export const dynamic = 'force-dynamic'

export default async function ShotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shotId: string }>
  searchParams: Promise<{ projectId?: string }>
}) {
  const [{ shotId }, { projectId }] = await Promise.all([params, searchParams])
  const currentPath = projectId
    ? `/products/shots/${shotId}?projectId=${encodeURIComponent(projectId)}`
    : `/products/shots/${shotId}`
  return withPageSession(currentPath, () => renderShotDetail(shotId, projectId))
}

async function renderShotDetail(shotId: string, projectId: string | undefined) {
  if (!projectId) notFound()
  const routeState = await getProjectRouteState(projectId)
  if (routeState === 'missing') notFound()
  if (routeState === 'legacy') return <UnsupportedProjectNotice />
  const project = (await listProjects()).find(
    (candidate) => candidate.id === projectId,
  )
  if (!project) notFound()
  const graph = await getCanvasGraph(projectId)
  const node = graph.nodes.find(({ id: nodeId }) => nodeId === shotId)
  if (!node || node.type !== 'shot-codegen') notFound()
  const renderNodes = graph.nodes
    .filter((candidate) => candidate.type === 'shot-codegen')
    .sort((left, right) => (left.laneKey ?? '').localeCompare(right.laneKey ?? ''))
  const nodeIndex = renderNodes.findIndex(
    (candidate) => candidate.id === shotId,
  )
  const preview = await getLatestArtifact(
    projectId,
    shotId,
    'director-fabricate',
  )
  const previewUrl = preview
    ? `/api/artifacts/${preview.id}?projectId=${encodeURIComponent(projectId)}`
    : undefined
  // §1/§5：历史 render-mp4 作为初始视频；分辨率/fps 取自 renderSpec，构图模式取自
  // 同通道 shot-script 节点的 director-shot-spec（缺失则由页面显式展示"待生成"）。
  const rendered = await getLatestArtifact(projectId, shotId, 'render-mp4')
  const initialOutputUrl = rendered
    ? `/api/artifacts/${rendered.id}?projectId=${encodeURIComponent(projectId)}`
    : undefined
  const { resolution, fps } = resolveRenderSpec(node.data)
  const compositionMode = await resolveCompositionMode(projectId, graph.nodes, node.laneKey)
  return (
    <ShotDetail
      projectId={projectId}
      projectTitle={project.title}
      nodeId={shotId}
      laneKey={node.laneKey ?? 'S000'}
      sourceText={sourceTextOf(node)}
      previousNodeId={renderNodes[nodeIndex - 1]?.id}
      nextNodeId={renderNodes[nodeIndex + 1]?.id}
      previewUrl={previewUrl}
      initialOutputUrl={initialOutputUrl}
      resolution={resolution}
      fps={fps}
      compositionMode={compositionMode}
    />
  )
}

function sourceTextOf(node: CanvasGraphNode): string {
  const sourceUnit = node.data.sourceUnit
  if (!sourceUnit || typeof sourceUnit !== 'object' || Array.isArray(sourceUnit)) {
    return '分镜内容待生成'
  }
  const text = (sourceUnit as Record<string, unknown>).text
  return typeof text === 'string' && text.trim() ? text.trim() : '分镜内容待生成'
}
