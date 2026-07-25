import dagre from '@dagrejs/dagre'
import type { CanvasNodeType } from './types'

const NODE_WIDTH = 220
const NODE_HEIGHT = 100
const LANE_GAP = 80

const GLOBAL_TYPES = new Set<CanvasNodeType>([
  'script-import',
  'shot-split',
  'score',
  'export',
])

export interface LayoutNode {
  id: string
  type: CanvasNodeType
  laneKey?: string | null
}

export interface LayoutEdge {
  source: string
  target: string
}

export interface NodePosition {
  x: number
  y: number
}

/** 计算可直接赋给 React Flow/canvas_nodes.position 的左上角坐标。 */
export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): Map<string, NodePosition> {
  assertValidGraph(nodes, edges)
  const graph = createGraph(nodes, edges)
  dagre.layout(graph)

  const laneIndexes = indexLanes(nodes)
  return new Map(
    nodes.map((node) => {
      const point = graph.node(node.id) as { x: number; y: number }
      return [
        node.id,
        {
          x: Math.round(point.x - NODE_WIDTH / 2),
          y: normalizedY(node, point.y, laneIndexes),
        },
      ]
    })
  )
}

function createGraph(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 100,
    nodesep: LANE_GAP,
    marginx: 0,
    marginy: 0,
  })
  for (const node of nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const edge of edges) graph.setEdge(edge.source, edge.target)
  return graph
}

function indexLanes(nodes: LayoutNode[]): Map<string, number> {
  const laneKeys = [
    ...new Set(nodes.flatMap((node) => (node.laneKey ? [node.laneKey] : []))),
  ].sort()
  return new Map(laneKeys.map((laneKey, index) => [laneKey, index]))
}

function normalizedY(
  node: LayoutNode,
  dagreCenterY: number,
  laneIndexes: Map<string, number>
): number {
  if (GLOBAL_TYPES.has(node.type)) return 0
  if (!node.laneKey) return Math.round(dagreCenterY - NODE_HEIGHT / 2)
  const laneIndex = laneIndexes.get(node.laneKey)
  if (laneIndex === undefined) throw new Error(`无法定位分镜通道：${node.laneKey}`)
  return (laneIndex + 1) * (NODE_HEIGHT + LANE_GAP)
}

function assertValidGraph(nodes: LayoutNode[], edges: LayoutEdge[]): void {
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (nodeIds.size !== nodes.length) throw new Error('布局输入包含重复节点 ID')
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error(`布局边引用了不存在的节点：${edge.source} -> ${edge.target}`)
    }
  }
}
