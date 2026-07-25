import { notFound } from 'next/navigation'
import { getLatestArtifact } from '@/features/artifacts'
import { getCanvasGraph, listProjects, type CanvasGraphNode } from '@/features/canvas'
import { ShotDetail } from './shot-detail'
import { resolveCompositionMode, resolveRenderSpec } from './shot-server-data'

export const dynamic = 'force-dynamic'

export default async function ShotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ projectId?: string }>
}) {
  const [{ id }, { projectId }] = await Promise.all([params, searchParams])
  if (!projectId) notFound()
  const graph = await getCanvasGraph(projectId)
  const node = graph.nodes.find(({ id: nodeId }) => nodeId === id)
  if (!node || node.type !== 'shot-codegen') notFound()
  const renderNodes = graph.nodes
    .filter((candidate) => candidate.type === 'shot-codegen')
    .sort((left, right) => (left.laneKey ?? '').localeCompare(right.laneKey ?? ''))
  const nodeIndex = renderNodes.findIndex((candidate) => candidate.id === id)
  const preview = await getLatestArtifact(projectId, id, 'director-fabricate')
  const previewUrl = preview
    ? `/api/artifacts/${preview.id}?projectId=${encodeURIComponent(projectId)}`
    : undefined
  // §1/§5：历史 render-mp4 作为初始视频；分辨率/fps 取自 renderSpec，构图模式取自
  // 同通道 shot-script 节点的 director-shot-spec（缺失则由页面显式展示"待生成"）。
  const rendered = await getLatestArtifact(projectId, id, 'render-mp4')
  const initialOutputUrl = rendered
    ? `/api/artifacts/${rendered.id}?projectId=${encodeURIComponent(projectId)}`
    : undefined
  const { resolution, fps } = resolveRenderSpec(node.data)
  const compositionMode = await resolveCompositionMode(projectId, graph.nodes, node.laneKey)
  return (
    <ShotDetail
      projectId={projectId}
      projectTitle={
        (await listProjects()).find((project) => project.id === projectId)
          ?.title ?? '未命名项目'
      }
      nodeId={id}
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
