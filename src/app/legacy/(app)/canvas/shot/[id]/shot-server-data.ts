import 'server-only'
import { getLatestArtifact, readArtifact } from '@/features/artifacts'
import type { CanvasGraphNode } from '@/features/canvas'

export interface ShotResolution {
  width: number
  height: number
}

/** shot-codegen 节点 renderSpec 中可供页面展示的真实字段。 */
export interface ShotRenderSpec {
  resolution?: ShotResolution
  fps?: number
}

/**
 * 从 shot-codegen 节点 `data.renderSpec` 防御式提取真实画幅 / 帧率。
 * 尚未 fabricate/渲染（无 renderSpec）时返回空对象，由页面显式展示"待生成"。
 */
export function resolveRenderSpec(data: Record<string, unknown>): ShotRenderSpec {
  const spec = data.renderSpec
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return {}
  const record = spec as Record<string, unknown>
  const { width, height, fps } = record
  return {
    ...(typeof width === 'number' && typeof height === 'number'
      ? { resolution: { width, height } }
      : {}),
    ...(typeof fps === 'number' ? { fps } : {}),
  }
}

/**
 * 构图模式来自**同通道 shot-script 节点**的 `director-shot-spec` 产物（不是当前
 * shot-codegen 节点），产物形状为 `{ shots: [{ id: laneKey, composition: { mode } }] }`。
 * 未生成 shot spec / 解析失败 / 找不到对应分镜时返回 undefined，由页面展示"待生成"。
 */
export async function resolveCompositionMode(
  projectId: string,
  nodes: readonly CanvasGraphNode[],
  laneKey: string | null
): Promise<string | undefined> {
  if (!laneKey) return undefined
  const scriptNode = nodes.find(
    (node) => node.type === 'shot-script' && node.laneKey === laneKey
  )
  if (!scriptNode) return undefined
  const artifact = await getLatestArtifact(
    projectId,
    scriptNode.id,
    'director-shot-spec'
  )
  if (!artifact) return undefined
  try {
    const { bytes } = await readArtifact(projectId, artifact.id)
    const plan: unknown = JSON.parse(bytes.toString('utf8'))
    const shots = (plan as { shots?: unknown }).shots
    if (!Array.isArray(shots)) return undefined
    const shot = shots.find((item) => (item as { id?: unknown }).id === laneKey)
    const mode = (shot as { composition?: { mode?: unknown } } | undefined)?.composition
      ?.mode
    return typeof mode === 'string' ? mode : undefined
  } catch {
    return undefined
  }
}
