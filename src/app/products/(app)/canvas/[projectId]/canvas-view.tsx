'use client'

import Link from 'next/link'
import { Download, Play } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { QueueStatusBar } from '@/components/ui/queue-status-bar'
import { Toast } from '@/components/ui/toast'
import { TopBar } from '@/components/ui/top-bar'
import type { CanvasGraphEdge, CanvasGraphNode } from '@/features/canvas'
import { fadeInUp } from '@/lib/motion/variants'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { productExportHref } from '@/features/navigation/products-routes'
import { CanvasInspector } from './canvas-inspector'
import { startPipeline, stopPipeline } from './canvas-action-api'
import {
  describePipelineResult,
  type PipelineFeedback,
} from './pipeline-feedback'
import {
  buildLaneSummaries,
  LaneSummaryDetails,
  toFlowEdge,
  toFlowNode,
  type LaneSummary,
} from './flow-elements'

export interface CanvasViewProps {
  projectId: string
  projectTitle: string
  autopilot: boolean
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
}

export function CanvasView({
  projectId,
  projectTitle,
  autopilot,
  nodes,
  edges,
}: CanvasViewProps) {
  const router = useRouter()
  const [pipelineSubmitting, setPipelineSubmitting] = useState(false)
  const [pipelineFeedback, setPipelineFeedback] = useState<PipelineFeedback>()
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set())
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id)
  const laneSummaries = useMemo(() => buildLaneSummaries(nodes), [nodes])
  const hiddenNodeIds = useMemo(
    () =>
      new Set(
        nodes
          .filter(
            (node) =>
              node.laneKey &&
              collapsedLanes.has(node.laneKey) &&
              node.type !== 'shot-script'
          )
          .map((node) => node.id)
      ),
    [collapsedLanes, nodes]
  )
  const flowNodes = useMemo(
    () => nodes.map((node) => toFlowNode(node, hiddenNodeIds, collapsedLanes)),
    [collapsedLanes, hiddenNodeIds, nodes]
  )
  const flowEdges = useMemo(
    () => edges.map((edge) => toFlowEdge(edge, hiddenNodeIds)),
    [edges, hiddenNodeIds]
  )
  const selectedNode = nodes.find(({ id }) => id === selectedNodeId)
  const completed = nodes.filter(({ status }) => status === 'success').length
  const active = nodes.filter(
    ({ status }) => status === 'pending' || status === 'running'
  ).length
  const failed = nodes.filter(({ status }) => status === 'failed').length
  const rendererNodeId = nodes.find(({ type }) => type === 'shot-codegen')?.id

  usePublishNavContext({ projectId, rendererNodeId })

  useEffect(() => {
    if (!nodes.some(({ status }) => status === 'pending' || status === 'running')) return
    const timeout = window.setTimeout(() => router.refresh(), 1500)
    return () => window.clearTimeout(timeout)
  }, [nodes, router])

  function toggleLane(laneKey: string): void {
    setCollapsedLanes((current) => {
      const next = new Set(current)
      if (next.has(laneKey)) next.delete(laneKey)
      else next.add(laneKey)
      return next
    })
  }

  async function togglePipeline(): Promise<void> {
    setPipelineSubmitting(true)
    setPipelineFeedback(undefined)
    try {
      const result = autopilot
        ? await stopPipeline(projectId)
        : await startPipeline(projectId)
      setPipelineFeedback(describePipelineResult(result))
      router.refresh()
    } catch (error) {
      setPipelineFeedback({
        variant: 'error',
        title: '工作流操作失败',
        body: error instanceof Error ? error.message : '工作流操作失败',
      })
    } finally {
      setPipelineSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 bg-canvas-bg">
      <section className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={projectTitle}
          meta={`${nodes.length} 节点`}
          actions={
            <>
              <Button
                variant="gray"
                size="sm"
                icon={Play}
                disabled={pipelineSubmitting}
                onClick={() => void togglePipeline()}
              >
                {autopilot ? '停止自动推进' : '一键启动'}
              </Button>
              <Link href={productExportHref(projectId)}>
                <Button size="sm" icon={Download}>导出 MP4</Button>
              </Link>
            </>
          }
        />
        {pipelineFeedback && (
          <div className="px-4 pt-3">
            <Toast
              variant={pipelineFeedback.variant}
              title={pipelineFeedback.title}
              body={pipelineFeedback.body}
            />
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            onlyRenderVisibleElements
            minZoom={0.05}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          >
            <Background color="var(--color-canvas-grid)" gap={20} size={1} />
            <MiniMap pannable zoomable className="!bg-surface !shadow-card" />
            <Controls className="!border-separator !bg-surface !shadow-card" />
          </ReactFlow>
          <LanePanel
            laneSummaries={laneSummaries}
            collapsedLanes={collapsedLanes}
            onToggle={toggleLane}
          />
        </div>
        <QueueStatusBar
          completed={completed}
          active={active}
          failed={failed}
          total={nodes.length}
        />
      </section>
      <CanvasInspector projectId={projectId} node={selectedNode} onQueued={() => router.refresh()} />
    </div>
  )
}

interface LanePanelProps {
  laneSummaries: LaneSummary[]
  collapsedLanes: Set<string>
  onToggle: (laneKey: string) => void
}

function LanePanel({ laneSummaries, collapsedLanes, onToggle }: LanePanelProps) {
  return (
    <aside className="absolute left-4 top-4 max-h-[calc(100%-8rem)] w-56 overflow-auto rounded-md border border-separator bg-glass p-3 shadow-float backdrop-blur-xl">
      <p className="mb-2 text-xs font-semibold text-label">
        分镜通道 · {laneSummaries.length}
      </p>
      <div className="space-y-2">
        {laneSummaries.map((summary) => {
          const collapsed = collapsedLanes.has(summary.laneKey)
          return (
            <div key={summary.laneKey}>
              <Button
                variant="gray"
                size="sm"
                aria-expanded={!collapsed}
                onClick={() => onToggle(summary.laneKey)}
                className="w-full justify-between"
              >
                <span className="truncate">{summary.laneKey}</span>
                <span className="text-label-secondary">
                  {collapsed ? '展开' : '折叠'}
                </span>
              </Button>
              <AnimatePresence initial={false}>
                {!collapsed && (
                  <motion.div
                    key="summary"
                    variants={fadeInUp}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                  >
                    <LaneSummaryDetails summary={summary} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
