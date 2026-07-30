'use client'

import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  AudioLines,
  Captions,
  Clapperboard,
  FileCode,
  FileInput,
  Film,
  Globe2,
  Music,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { PipelineNode } from '@/components/ui/pipeline-node'
import {
  getNodeStatusLabel,
  PIPELINE_NODE_TITLE,
} from '@/components/ui/pipeline-node-status'
import type { CanvasNodeType, NodeStatus } from '@/features/canvas/types'

export type CanvasFlowNodeData = {
  nodeType: CanvasNodeType
  status: NodeStatus
  laneKey: string | null
  collapsed: boolean
  title?: string
  statusLabel?: string
  borderClass?: string
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, 'pipeline'>

const NODE_ICON: Record<CanvasNodeType, LucideIcon> = {
  'script-import': FileInput,
  'shot-split': Sparkles,
  score: Music,
  export: Film,
  'shot-script': Clapperboard,
  'shot-codegen': FileCode,
  'shot-sfx': AudioLines,
  'shot-subtitle': Captions,
  'shot-qa': ShieldCheck,
  'audio-transcribe': AudioLines,
  'website-stage': Globe2,
}

export function CanvasFlowNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const statusLabel = data.statusLabel ?? (
    data.collapsed && data.nodeType === 'shot-script'
      ? '已折叠 · 5 节点'
      : getNodeStatusLabel(data.nodeType, data.status)
  )

  return (
    <div className="relative">
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-ds-border !bg-ds-surface"
      />
      <PipelineNode
        title={data.title ?? PIPELINE_NODE_TITLE[data.nodeType]}
        meta={data.laneKey ?? undefined}
        nodeType={data.nodeType}
        status={data.status}
        statusLabel={statusLabel}
        selected={selected}
        icon={NODE_ICON[data.nodeType]}
        className={data.borderClass}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-ds-border !bg-ds-surface"
      />
    </div>
  )
}
