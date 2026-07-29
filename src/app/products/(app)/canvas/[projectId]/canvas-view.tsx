'use client'

import Link from 'next/link'
import { Download, Play } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Background,
  ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { QueueStatusBar } from '@/components/ui/queue-status-bar'
import { Toast } from '@/components/ui/toast'
import { BillingCanvasUsage } from '@/features/billing/ui/usage-panels'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import type { CanvasGraphEdge, PositionedCanvasNode } from '@/features/canvas'
import { fadeInUp } from '@/lib/motion/variants'
import { useProjectStatusStream } from '@/lib/hooks/use-project-status-stream'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { productExportHref } from '@/features/navigation/products-routes'
import { CanvasAutoHideTopBar } from './canvas-auto-hide-top-bar'
import { CanvasFlowNode } from './canvas-flow-node'
import { CanvasInspector } from './canvas-inspector'
import { CanvasMiniMap } from './canvas-minimap'
import { CanvasViewportToolbar } from './canvas-viewport-toolbar'
import { StageErrorDialog } from './stage-error-dialog'

const canvasNodeTypes = { pipeline: CanvasFlowNode }
import {
  BillingQuotaExhaustedError,
  startPipeline,
  stopPipeline,
} from './canvas-action-api'
import { applyStatusOverlay } from './live-status'
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
  billing: BillingUiProjection
  nodes: PositionedCanvasNode[]
  edges: CanvasGraphEdge[]
}

export function CanvasView({
  projectId,
  projectTitle,
  autopilot,
  billing,
  nodes,
  edges,
}: CanvasViewProps) {
  const router = useRouter()
  const [pipelineSubmitting, setPipelineSubmitting] = useState(false)
  const [pipelineFeedback, setPipelineFeedback] = useState<PipelineFeedback>()
  const [pipelineQuotaOpen, setPipelineQuotaOpen] = useState(false)
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set())
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id)
  // SSE 状态覆盖层：props 是全量真值基线，覆盖层只做逐节点 status 替换。
  const hasActiveBaseline = nodes.some(
    ({ status }) => status === 'pending' || status === 'running'
  )
  const live = useProjectStatusStream(projectId, hasActiveBaseline || autopilot)
  const overlay = useMemo(
    () => applyStatusOverlay(nodes, live.statuses),
    [live.statuses, nodes]
  )
  const liveNodes = overlay.nodes
  const topologyHandled = useRef(0)
  const laneSummaries = useMemo(() => buildLaneSummaries(liveNodes), [liveNodes])
  const hiddenNodeIds = useMemo(
    () =>
      new Set(
        liveNodes
          .filter(
            (node) =>
              node.laneKey &&
              collapsedLanes.has(node.laneKey) &&
              node.type !== 'shot-script'
          )
          .map((node) => node.id)
      ),
    [collapsedLanes, liveNodes]
  )
  const flowNodes = useMemo(
    () =>
      liveNodes.map((node) =>
        toFlowNode(node, hiddenNodeIds, collapsedLanes, node.id === selectedNodeId)
      ),
    [collapsedLanes, hiddenNodeIds, liveNodes, selectedNodeId]
  )
  const flowEdges = useMemo(
    () => edges.map((edge) => toFlowEdge(edge, hiddenNodeIds)),
    [edges, hiddenNodeIds]
  )
  const selectedNode = liveNodes.find(({ id }) => id === selectedNodeId)
  const completed = liveNodes.filter(({ status }) => status === 'success').length
  const active = liveNodes.filter(
    ({ status }) => status === 'pending' || status === 'running'
  ).length
  const failed = liveNodes.filter(({ status }) => status === 'failed').length
  const rendererNodeId = liveNodes.find(({ type }) => type === 'shot-codegen')?.id

  usePublishNavContext({ projectId, rendererNodeId })

  // 兜底轮询：仅在 SSE 不健康时接管（二者硬互斥），行为与修复前一致。
  useEffect(() => {
    if (live.connected) return
    if (!liveNodes.some(({ status }) => status === 'pending' || status === 'running')) return
    const timeout = window.setTimeout(() => router.refresh(), 1500)
    return () => window.clearTimeout(timeout)
  }, [live.connected, liveNodes, router])

  // refresh 收敛：拓扑变化 / 覆盖层出现未知节点 / 节点进入 props 尚未见到的终态
  // 时才重拉全图（同步新泳道与 artifacts）；短防抖合并密集事件。
  useEffect(() => {
    const topologyChanged = live.topologyTick > topologyHandled.current
    if (!topologyChanged && overlay.unknownNodeIds.length === 0 && !overlay.terminalDrift) {
      return
    }
    const timeout = window.setTimeout(() => {
      topologyHandled.current = live.topologyTick
      router.refresh()
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [live.topologyTick, overlay, router])

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
      if (result.blockedNodes?.some(({ code }) =>
        code === 'quota_exhausted' || code === 'QUOTA_EXHAUSTED')) {
        setPipelineQuotaOpen(true)
      }
      router.refresh()
    } catch (error) {
      if (error instanceof BillingQuotaExhaustedError) {
        setPipelineQuotaOpen(true)
      }
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
    <div className="flex min-h-0 flex-1 bg-ds-canvas text-ds-text">
      <section className="relative flex min-w-0 flex-1 flex-col">
        <CanvasAutoHideTopBar
          title={projectTitle}
          meta={`${liveNodes.length} 节点`}
          actions={
            <>
              <BillingCanvasUsage projection={billing} />
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
          <div
            data-slot="pipeline-feedback"
            className="pointer-events-none absolute right-3 top-14 z-20 max-w-[calc(100%-1.5rem)] sm:right-4 sm:max-w-[calc(100%-2rem)]"
          >
            <Toast
              variant={pipelineFeedback.variant}
              title={pipelineFeedback.title}
              body={pipelineFeedback.body}
              className="w-full max-w-[360px]"
            />
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={canvasNodeTypes}
            fitView
            // 不用 onlyRenderVisibleElements：拓扑刷新后视口未重 fit 时，
            // 一端离屏会导致边被跳过渲染（重进页面 remount 才恢复）。
            nodesDraggable={false}
            nodesConnectable={false}
            minZoom={0.05}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          >
            <Background color="var(--ds-text-muted)" gap={20} size={1} />
            <CanvasMiniMap onSelectNode={setSelectedNodeId} />
            <CanvasViewportToolbar />
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
          total={liveNodes.length}
        />
      </section>
      <CanvasInspector
        projectId={projectId}
        node={selectedNode}
        onQueued={() => router.refresh()}
        onQuotaExhausted={() => setPipelineQuotaOpen(true)}
      />
      <StageErrorDialog
        open={pipelineQuotaOpen}
        stage=""
        message=""
        errorCode="quota_exhausted"
        billingProjection={billing}
        retryable={false}
        onClose={() => setPipelineQuotaOpen(false)}
        onRetry={() => undefined}
      />
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
    <aside className="absolute left-4 top-4 max-h-[calc(100%-8rem)] w-56 overflow-auto rounded-md border border-ds-border bg-ds-surface p-3 text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl">
      <p className="mb-2 text-xs font-semibold">
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
                <span className="text-ds-text-muted">
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
