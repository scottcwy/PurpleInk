import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { ReactNode } from 'react'
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill'
import type {
  CanvasGraphEdge,
  CanvasGraphNode,
  NodeStatus,
  PositionedCanvasNode,
  ShotLaneNodeType,
} from '@/features/canvas'
import { NODE_HEIGHT, NODE_WIDTH } from '@/features/canvas/layout'
import { cn } from '@/lib/utils'

type ViewNodeData = {
  label: ReactNode
  type: CanvasGraphNode['type']
  status: CanvasGraphNode['status']
  laneKey: string | null
}

type ViewNode = Node<ViewNodeData>

/** 与画布节点边框同一套 stage token，驱动 border class 与 MiniMap 填色。 */
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
  const type = node.data.type
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
  const stage = STAGE_TOKEN[node.type]
  return {
    id: node.id,
    position: node.position,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    selected,
    hidden: hiddenNodeIds.has(node.id),
    className: cn(
      '!w-[220px] !rounded-lg !border !border-ds-border !bg-ds-surface !p-0 !text-ds-text !shadow-[var(--ds-shadow)]',
      `!border-stage-${stage}`
    ),
    data: {
      type: node.type,
      status: node.status,
      laneKey: node.laneKey,
      label: nodeLabel(node, collapsed),
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

function nodeLabel(node: CanvasGraphNode, collapsed: boolean): ReactNode {
  return (
    <div className="flex min-h-20 flex-col items-start justify-between gap-3 p-3 text-left">
      <div>
        <p className="text-[13px] font-semibold text-ds-text">{NODE_LABEL[node.type]}</p>
        {node.laneKey && (
          <p className="mt-1 text-[11px] text-ds-text-muted">{node.laneKey}</p>
        )}
      </div>
      <StatusPill
        variant={getNodeStatusPresentation(node.status).variant}
        label={
          collapsed && node.type === 'shot-script'
            ? '已折叠 · 5 节点'
            : getNodeStatusPresentation(node.status).label
        }
      />
    </div>
  )
}

const STATUS_VARIANT: Record<NodeStatus, StatusPillVariant> = {
  idle: 'pending',
  pending: 'pending',
  running: 'generating',
  success: 'rendered',
  failed: 'failed',
  cancelled: 'failed',
  stale: 'cached',
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: '空闲',
  pending: '待执行',
  running: '执行中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
  stale: '需更新',
}

export function getNodeStatusPresentation(
  status: NodeStatus
): { variant: StatusPillVariant; label: string } {
  return {
    variant: STATUS_VARIANT[status],
    label: STATUS_LABEL[status],
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
              label={`${getLaneNodeLabel(node.type)} · ${status.label}`}
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

const NODE_LABEL: Record<CanvasGraphNode['type'], string> = {
  'script-import': '脚本导入',
  'shot-split': '语义拆分',
  score: '全局配乐',
  export: '合并导出',
  'shot-script': '分镜脚本',
  'shot-codegen': '代码生成',
  'shot-sfx': '音效',
  'shot-subtitle': '字幕',
  'shot-qa': '验收',
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
