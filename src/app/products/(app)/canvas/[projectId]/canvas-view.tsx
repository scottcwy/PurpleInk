'use client'

import Link from 'next/link'
import { Clock, Download, Play, Square } from 'lucide-react'
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
import type { WorkspaceConcurrencyProjection } from '@/features/ai/workspace-concurrency-projection'
import type { CanvasGraphEdge, PositionedCanvasNode } from '@/features/canvas'
import { useProjectStatusStream } from '@/lib/hooks/use-project-status-stream'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { productExportHref } from '@/features/navigation/products-routes'
import { CanvasAutoHideTopBar } from './canvas-auto-hide-top-bar'
import {
  CanvasContextMenu,
  type CanvasMenuTarget,
} from './canvas-context-menu'
import { CanvasFlowNode } from './canvas-flow-node'
import { CanvasInspector } from './canvas-inspector'
import { CanvasLanePanel } from './canvas-lane-panel'
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
  toFlowEdge,
  toFlowNode,
} from './flow-elements'

export interface CanvasViewProps {
  projectId: string
  projectTitle: string
  autopilot: boolean
  billing: BillingUiProjection
  concurrency: WorkspaceConcurrencyProjection
  nodes: PositionedCanvasNode[]
  edges: CanvasGraphEdge[]
}

export function CanvasView({
  projectId,
  projectTitle,
  autopilot,
  billing,
  concurrency,
  nodes,
  edges,
}: CanvasViewProps) {
  const router = useRouter()
  const [pipelineSubmitting, setPipelineSubmitting] = useState(false)
  const [pipelineStopping, setPipelineStopping] = useState(false)
  const [pipelineFeedback, setPipelineFeedback] = useState<PipelineFeedback>()
  const [pipelineQuotaOpen, setPipelineQuotaOpen] = useState(false)
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set())
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id)
  const [menuTarget, setMenuTarget] = useState<CanvasMenuTarget | null>(null)
  const canvasRootRef = useRef<HTMLDivElement>(null)
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
  const waiting = liveNodes.filter(
    ({ executionNotice }) => executionNotice != null
  ).length
  const active = liveNodes.filter(
    ({ status, executionNotice }) =>
      (status === 'pending' || status === 'running') && !executionNotice
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

  useEffect(() => {
    if (!pipelineStopping) return
    let cancelled = false
    let timeout: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const result = await stopPipeline(projectId)
        if (cancelled) return
        setPipelineFeedback(describePipelineResult(result))
        if (result.status === 'stopped') {
          setPipelineStopping(false)
          router.refresh()
          return
        }
        timeout = window.setTimeout(() => void poll(), 1500)
      } catch (error) {
        if (cancelled) return
        setPipelineStopping(false)
        setPipelineFeedback({
          variant: 'error',
          title: '停止状态确认失败',
          body: error instanceof Error ? error.message : '停止状态确认失败',
        })
      }
    }
    timeout = window.setTimeout(() => void poll(), 1500)
    return () => {
      cancelled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [pipelineStopping, projectId, router])

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
      const result = autopilot || pipelineStopping
        ? await stopPipeline(projectId)
        : await startPipeline(projectId)
      setPipelineStopping(result.status === 'stopping')
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
    <div ref={canvasRootRef} className="flex min-h-0 flex-1 bg-ds-canvas text-ds-text">
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
                icon={
                  pipelineStopping
                    ? Clock
                    : autopilot
                      ? Square
                      : Play
                }
                disabled={pipelineSubmitting || pipelineStopping}
                onClick={() => void togglePipeline()}
              >
                {pipelineStopping
                  ? '正在停止'
                  : autopilot
                    ? '停止项目'
                    : '一键启动'}
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
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              setSelectedNodeId(node.id)
              setMenuTarget({
                kind: 'node',
                nodeId: node.id,
                position: { x: event.clientX, y: event.clientY },
              })
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault()
              setMenuTarget({
                kind: 'pane',
                position: { x: event.clientX, y: event.clientY },
              })
            }}
          >
            <Background color="var(--ds-text-muted)" gap={20} size={1} />
            <CanvasMiniMap onSelectNode={setSelectedNodeId} />
            <CanvasViewportToolbar />
            <CanvasContextMenu
              projectId={projectId}
              nodes={liveNodes}
              target={menuTarget}
              onClose={() => setMenuTarget(null)}
              onQueued={() => router.refresh()}
              onQuotaExhausted={() => setPipelineQuotaOpen(true)}
              onFeedback={setPipelineFeedback}
              fullscreenTargetRef={canvasRootRef}
            />
          </ReactFlow>
          <CanvasLanePanel
            laneSummaries={laneSummaries}
            collapsedLanes={collapsedLanes}
            onToggle={toggleLane}
          />
        </div>
        <QueueStatusBar
          completed={completed}
          active={active}
          waiting={waiting}
          failed={failed}
          total={liveNodes.length}
          label={`套餐并发 ${concurrency.active}/${concurrency.limit} · ${concurrency.waiting} 个分镜排队`}
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
