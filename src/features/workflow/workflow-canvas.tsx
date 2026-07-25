'use client'

import {
  AudioLines,
  Combine,
  Film,
  ListTree,
  Play,
  ScanEye,
  Sparkles,
  WandSparkles,
  Workflow,
} from 'lucide-react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PipelineNode } from '@/components/ui/pipeline-node'
import type {
  WorkflowBlueprintNode,
  WorkflowIcon,
} from './blueprint-model'
import {
  STAGE_B_WORKFLOW_NODES,
  WORKFLOW_BLUEPRINT_EDGES,
} from './blueprint-model'

const ICONS = {
  play: Play,
  'list-tree': ListTree,
  sparkles: Sparkles,
  'audio-lines': AudioLines,
  film: Film,
  'scan-eye': ScanEye,
  combine: Combine,
} satisfies Record<WorkflowIcon, typeof Play>

export function WorkflowCanvas({
  nodes = STAGE_B_WORKFLOW_NODES,
  fixture = false,
}: {
  nodes?: readonly WorkflowBlueprintNode[]
  fixture?: boolean
}) {
  const flowNodes: Node<WorkflowBlueprintNode>[] = nodes.map((node) => ({
    id: node.id,
    type: 'pipeline',
    position: node.position,
    data: node,
  }))
  const flowEdges: Edge[] = WORKFLOW_BLUEPRINT_EDGES.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--ds-blue)' },
    style: { stroke: 'var(--ds-blue)', strokeWidth: 2 },
  }))

  return (
    <section className="flex h-[620px] min-w-0 flex-col overflow-hidden rounded-lg border border-ds-border bg-ds-canvas text-ds-text">
      <header className="flex min-h-[58px] flex-wrap items-center justify-between gap-3 border-b border-ds-border bg-ds-surface px-5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <Workflow aria-hidden className="size-[18px] text-ds-primary" />
          <span>
            <strong className="block text-sm font-semibold">RAG 视频生成工作流</strong>
            <span className="block font-mono text-[9px] text-ds-text-muted">
              React Flow · 7 节点 · {fixture ? 'CANONICAL FIXTURE' : 'STAGE B BLUEPRINT'}
            </span>
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="自动布局将在 Stage B 接线"
            className="flex items-center gap-2 rounded-md border border-ds-border bg-ds-surface px-3.5 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            <WandSparkles aria-hidden className="size-4" />
            自动布局
          </button>
          <button
            type="button"
            disabled
            title="运行能力将在 Stage B 接线"
            className="ds-primary-button flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Play aria-hidden className="size-4" />
            运行工作流
          </button>
        </div>
      </header>
      {!fixture ? (
        <p className="border-b border-ds-border bg-ds-blue-soft px-5 py-2 text-xs text-ds-blue">
          结构预览：节点尚未接入 ProductFlowVersion、FlowNode 或 Artifact。
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={{ pipeline: WorkflowFlowNode }}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--ds-text-muted)" gap={20} size={1} />
          <Controls
            showInteractive={false}
            className="!overflow-hidden !rounded-md !border !border-ds-border !bg-ds-surface !shadow-none [&_button]:!border-ds-border [&_button]:!bg-transparent [&_button]:!text-ds-text-muted"
          />
        </ReactFlow>
      </div>
    </section>
  )
}

function WorkflowFlowNode({ data }: NodeProps<Node<WorkflowBlueprintNode>>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-0 !bg-ds-blue"
      />
      <PipelineNode {...data} icon={ICONS[data.icon]} />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-0 !bg-ds-blue"
      />
    </>
  )
}
