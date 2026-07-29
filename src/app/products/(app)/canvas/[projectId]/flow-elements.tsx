import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { StatusPill } from '@/components/ui/status-pill'
import {
  getNodeStatusLabel,
  getNodeStatusPresentation,
} from '@/components/ui/pipeline-node-status'
import type {
  CanvasGraphEdge,
  CanvasGraphNode,
  NodeStatus,
  PositionedCanvasNode,
  ShotLaneNodeType,
} from '@/features/canvas'
import { NODE_HEIGHT, NODE_WIDTH } from '@/features/canvas/layout'
import type { CanvasFlowNodeData } from './canvas-flow-node'

export {
  getNodeStatusLabel,
  getNodeStatusPresentation,
} from '@/components/ui/pipeline-node-status'

type ViewNode = Node<CanvasFlowNodeData, 'pipeline'>

/** 与画布节点边框同一套 stage token，驱动 MiniMap 填色。 */
type StageToken = 'ingest' | 'direct' | 'shot' | 'audio' | 'assemble' | 'finalize'

const STAGE_TOKEN: Record<CanvasGraphNode['type'], StageToken> = {
  'script-import': 'ingest',
  'shot-split': 'ingest',
  score: 'assemble',
  export: 'finalize',
  'shot-script': 'shot',
  'shot-codegen': 'direct',
  'shot-sfx': 'audio',
  'shot-subtitle': 'audio',
  'shot-qa': 'finalize',
  'audio-transcribe': 'audio',
  'website-stage': 'direct',
}

export interface LaneSummaryNode {
  type: ShotLaneNodeType
  status: NodeStatus
}

export interface LaneSummary {
  laneKey: string
  nodes: LaneSummaryNode[]
  sourceExcerpt?: string
  isComplete: boolean
}

interface MutableLaneSummary {
  laneKey: string
  nodesByType: Map<ShotLaneNodeType, LaneSummaryNode>
  sourceExcerpt?: string
}

const SHOT_LANE_NODE_ORDER: readonly ShotLaneNodeType[] = [
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
]

const SOURCE_EXCERPT_LENGTH = 48

export function buildLaneSummaries(nodes: readonly CanvasGraphNode[]): LaneSummary[] {
  const summaries = new Map<string, MutableLaneSummary>()

  for (const node of nodes) {
    if (!node.laneKey || !isShotLaneNodeType(node.type)) continue

    const summary = summaries.get(node.laneKey) ?? {
      laneKey: node.laneKey,
      nodesByType: new Map<ShotLaneNodeType, LaneSummaryNode>(),
    }
    if (!summaries.has(node.laneKey)) summaries.set(node.laneKey, summary)

    if (!summary.nodesByType.has(node.type)) {
      summary.nodesByType.set(node.type, { type: node.type, status: node.status })
    }
    if (node.type === 'shot-script' && summary.sourceExcerpt === undefined) {
      summary.sourceExcerpt = extractSourceExcerpt(node.data)
    }
  }

  return [...summaries.values()]
    .sort((left, right) => left.laneKey.localeCompare(right.laneKey))
    .map((summary) => {
      const laneNodes = SHOT_LANE_NODE_ORDER.flatMap((type) => {
        const node = summary.nodesByType.get(type)
        return node ? [node] : []
      })
      return {
        laneKey: summary.laneKey,
        nodes: laneNodes,
        ...(summary.sourceExcerpt ? { sourceExcerpt: summary.sourceExcerpt } : {}),
        isComplete: laneNodes.length === SHOT_LANE_NODE_ORDER.length,
      }
    })
}

export function miniMapNodeColor(node: Node): string {
  const type = node.data.nodeType ?? node.data.type
  if (!isCanvasNodeType(type)) return 'var(--ds-text-muted)'
  return `var(--color-stage-${STAGE_TOKEN[type]})`
}

export function toFlowNode(
  node: PositionedCanvasNode,
  hiddenNodeIds: Set<string>,
  collapsedLanes: Set<string>,
  selected = false
): ViewNode {
  const collapsed = Boolean(node.laneKey && collapsedLanes.has(node.laneKey))
  return {
    id: node.id,
    type: 'pipeline',
    position: node.position,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    selected,
    hidden: hiddenNodeIds.has(node.id),
    // 外壳透明，选中/阶段描边由 PipelineNode 承担，避免与 RF 默认 .selected 叠样式。
    className: '!bg-transparent !border-0 !p-0 !shadow-none',
    data: {
      nodeType: node.type,
      status: node.status,
      laneKey: node.laneKey,
      collapsed,
    },
  }
}

export function toFlowEdge(edge: CanvasGraphEdge, hiddenNodeIds: Set<string>): Edge {
  return {
    ...edge,
    hidden: hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target),
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'var(--ds-text-muted)' },
  }
}

export function getLaneNodeLabel(type: ShotLaneNodeType): string {
  return LANE_NODE_LABEL[type]
}

export function LaneSummaryDetails({ summary }: { summary: LaneSummary }) {
  return (
    <div className="space-y-2 px-1 pb-2 pt-1">
      {summary.sourceExcerpt && (
        <p className="text-xs leading-relaxed text-ds-text-muted">
          {summary.sourceExcerpt}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {summary.nodes.map((node) => {
          const status = getNodeStatusPresentation(node.status)
          return (
            <StatusPill
              key={node.type}
              variant={status.variant}
              icon={status.icon}
              label={`${getLaneNodeLabel(node.type)} · ${getNodeStatusLabel(node.type, node.status)}`}
            />
          )
        })}
      </div>
      {!summary.isComplete && (
        <StatusPill
          variant="failed"
          label={`数据不完整 ${summary.nodes.length}/${SHOT_LANE_NODE_ORDER.length}`}
        />
      )}
    </div>
  )
}

const LANE_NODE_LABEL: Record<ShotLaneNodeType, string> = {
  'shot-script': '脚本',
  'shot-codegen': '代码',
  'shot-sfx': '音效',
  'shot-subtitle': '字幕',
  'shot-qa': '验收',
}

function isCanvasNodeType(value: unknown): value is CanvasGraphNode['type'] {
  return typeof value === 'string' && Object.hasOwn(STAGE_TOKEN, value)
}

function isShotLaneNodeType(type: CanvasGraphNode['type']): type is ShotLaneNodeType {
  return SHOT_LANE_NODE_ORDER.some((candidate) => candidate === type)
}

function extractSourceExcerpt(data: Record<string, unknown>): string | undefined {
  const sourceUnit = data.sourceUnit
  if (!sourceUnit || typeof sourceUnit !== 'object' || Array.isArray(sourceUnit)) return undefined

  const text = (sourceUnit as Record<string, unknown>).text
  if (typeof text !== 'string') return undefined

  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined

  const characters = Array.from(normalized)
  if (characters.length <= SOURCE_EXCERPT_LENGTH) return normalized
  return `${characters.slice(0, SOURCE_EXCERPT_LENGTH).join('')}…`
}
