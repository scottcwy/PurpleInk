import type { PositionedCanvasNode } from '@/features/canvas'
import type { NodeStatusValue } from '@/lib/stream/status-bus'

/** 终态集合：进入终态需要一次 refresh 同步 artifacts / data 给 inspector。 */
const TERMINAL_STATUSES: ReadonlySet<NodeStatusValue> = new Set([
  'success',
  'failed',
  'cancelled',
  // skipped 产生 marker 产物与 skipMeta，同样需 refresh 同步给 inspector。
  'skipped',
  // blocked 需要 refresh 同步 workflowBlock 与确认指纹。
  'blocked',
])

export interface StatusOverlayResult {
  /** props 基线叠加 SSE 覆盖层后的节点数组（只改 status，坐标与产物不动）。 */
  nodes: PositionedCanvasNode[]
  /** 覆盖层里 props 中不存在的 nodeId（扇出新增的兜底信号，需 refresh 拉全图）。 */
  unknownNodeIds: string[]
  /** 覆盖层把某节点推进到了 props 尚未见到的终态（需 refresh 同步产物）。 */
  terminalDrift: boolean
}

/**
 * 纯合成：props 为全量真值基线，SSE 覆盖层只做逐节点 status 替换。
 * 覆盖层恒不旧于 props（发布在 DB commit 后），因此直接覆盖即可。
 */
export function applyStatusOverlay(
  nodes: readonly PositionedCanvasNode[],
  statuses: ReadonlyMap<string, NodeStatusValue>
): StatusOverlayResult {
  const knownIds = new Set<string>()
  let terminalDrift = false
  const merged = nodes.map((node) => {
    knownIds.add(node.id)
    const overlay = statuses.get(node.id)
    if (!overlay || overlay === node.status) return node
    if (TERMINAL_STATUSES.has(overlay) && !TERMINAL_STATUSES.has(node.status)) {
      terminalDrift = true
    }
    return { ...node, status: overlay }
  })
  const unknownNodeIds = [...statuses.keys()].filter((id) => !knownIds.has(id))
  return { nodes: merged, unknownNodeIds, terminalDrift }
}
