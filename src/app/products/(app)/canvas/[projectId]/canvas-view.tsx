'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Background, ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { QueueStatusBar } from '@/components/ui/queue-status-bar'
import { Toast } from '@/components/ui/toast'
import type { BillingUiProjection } from '@/features/billing/ui/projection-contract'
import type { WorkspaceConcurrencyProjection } from '@/features/ai/workspace-concurrency-projection'
import type { CanvasGraphEdge, PositionedCanvasNode } from '@/features/canvas'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import { useProjectStatusStream } from '@/lib/hooks/use-project-status-stream'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import { CanvasAutoHideTopBar } from './canvas-auto-hide-top-bar'
import { CanvasExecutionActions } from './canvas-execution-actions'
import { CanvasContextMenu, type CanvasMenuTarget } from './canvas-context-menu'
import { CanvasFlowNode } from './canvas-flow-node'
import { CanvasInspector } from './canvas-inspector'
import { CanvasLanePanel } from './canvas-lane-panel'
import { CanvasMiniMap } from './canvas-minimap'
import { CanvasViewportToolbar } from './canvas-viewport-toolbar'
import { StageErrorDialog } from './stage-error-dialog'

import {
  BillingQuotaExhaustedError,
  startPipeline,
  stopPipeline,
} from './canvas-action-api'
import { applyStatusOverlay } from './live-status'
import { applyExecutionSnapshotToNodes } from './project-execution-sync'
import { useProjectExecution } from '@/features/projects/use-project-execution'
import {
  executionActionPresentation,
  projectExecutionLabel,
  websiteExecutionStages,
  websitePhaseBorderClass,
  websiteStagePresentation,
} from '@/features/projects/website-execution-presentation'
import {
  describePipelineResult,
  type PipelineFeedback,
} from './pipeline-feedback'
import { buildLaneSummaries, toFlowEdge, toFlowNode } from './flow-elements'
import { deriveQueueCounts, queueBarLabel } from './queue-projection'

const canvasNodeTypes = { pipeline: CanvasFlowNode }

export interface CanvasViewProps {
  projectId: string
  projectTitle: string
  initialExecution: ProjectExecutionSnapshot
  billing: BillingUiProjection
  concurrency: WorkspaceConcurrencyProjection
  nodes: PositionedCanvasNode[]
  edges: CanvasGraphEdge[]
}

export function CanvasView({
  projectId,
  projectTitle,
  initialExecution,
  billing,
  concurrency,
  nodes,
  edges,
}: CanvasViewProps) {
  const router = useRouter()
  const [pipelineSubmitting, setPipelineSubmitting] = useState(false)
  const [pipelineFeedback, setPipelineFeedback] = useState<PipelineFeedback>()
  const [pipelineQuotaOpen, setPipelineQuotaOpen] = useState(false)
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set())
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id)
  const [menuTarget, setMenuTarget] = useState<CanvasMenuTarget | null>(null)
  const canvasRootRef = useRef<HTMLDivElement>(null)
  const pipelineInFlightRef = useRef(false)
  const terminalRefreshRef = useRef<string | undefined>(undefined)
  const executionRuntime = useProjectExecution(projectId, initialExecution)
  const {
    execution,
    syncInterrupted,
    refresh: refreshExecution,
    adopt: adoptExecution,
  } = executionRuntime
  const databaseNodes = useMemo(
    () => applyExecutionSnapshotToNodes(nodes, execution),
    [execution, nodes],
  )
  const live = useProjectStatusStream(projectId, execution.active)
  const websiteStages = websiteExecutionStages(execution)
  const overlay = useMemo(
    () => applyStatusOverlay(
      databaseNodes,
      execution.projectKind === 'website' ? new Map() : live.statuses,
    ),
    [databaseNodes, execution.projectKind, live.statuses],
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
      liveNodes.map((node) => {
        const stageIndex = websiteStages.findIndex(
          (stage) => stage.nodeId === node.id,
        )
        const stage = stageIndex >= 0 ? websiteStages[stageIndex] : undefined
        return toFlowNode(
          node,
          hiddenNodeIds,
          collapsedLanes,
          node.id === selectedNodeId,
          stage
            ? {
                ...websiteStagePresentation(execution, stage, stageIndex),
                borderClass: websitePhaseBorderClass(stage.phase),
              }
            : undefined,
        )
      }),
    [collapsedLanes, execution, hiddenNodeIds, liveNodes, selectedNodeId, websiteStages],
  )
  const flowEdges = useMemo(
    () => edges.map((edge) => toFlowEdge(edge, hiddenNodeIds)),
    [edges, hiddenNodeIds]
  )
  const selectedNode = liveNodes.find(({ id }) => id === selectedNodeId)
  const queueCounts = deriveQueueCounts(liveNodes)
  const rendererNodeId = liveNodes.find(({ type }) => type === 'shot-codegen')?.id
  const websiteProject = execution.projectKind === 'website'
  const action = websiteProject
    ? executionActionPresentation(execution)
    : execution.active
      ? { mode: 'stop' as const, label: '停止项目' }
      : { mode: 'start' as const, label: '一键启动' }
  const visibleFeedback = pipelineFeedback ?? (syncInterrupted
    ? {
        variant: 'info' as const,
        title: '状态同步暂时中断',
        body: '后台任务不受影响，页面会继续自动重试。',
      }
    : undefined)

  usePublishNavContext({ projectId, rendererNodeId })

  // SSE 只提示“可能有变化”；真实状态始终重新读取数据库快照。
  useEffect(() => {
    if (!execution.active) return
    if (live.statuses.size === 0 && live.topologyTick === 0) return
    void refreshExecution()
  }, [
    execution.active,
    refreshExecution,
    live.statuses,
    live.topologyTick,
  ])

  // refresh 收敛：拓扑变化 / 覆盖层出现未知节点 / 节点进入 props 尚未见到的终态
  // 时才重拉全图（同步新泳道与 artifacts）；短防抖合并密集事件。
  useEffect(() => {
    if (websiteProject) return
    const topologyChanged = live.topologyTick > topologyHandled.current
    if (!topologyChanged && overlay.unknownNodeIds.length === 0 && !overlay.terminalDrift) {
      return
    }
    const timeout = window.setTimeout(() => {
      topologyHandled.current = live.topologyTick
      router.refresh()
    }, 400)
    return () => window.clearTimeout(timeout)
  }, [live.topologyTick, overlay, router, websiteProject])

  useEffect(() => {
    if (execution.active || execution.state === 'idle') return
    if (terminalRefreshRef.current === execution.revision) return
    terminalRefreshRef.current = execution.revision
    router.refresh()
  }, [execution.active, execution.revision, execution.state, router])

  async function togglePipeline(): Promise<void> {
    if (pipelineInFlightRef.current || action.mode === 'busy') return
    pipelineInFlightRef.current = true
    setPipelineSubmitting(true)
    setPipelineFeedback(undefined)
    try {
      const result = action.mode === 'stop'
        ? await stopPipeline(projectId)
        : await startPipeline(projectId)
      adoptExecution(result.execution)
      setPipelineFeedback(describePipelineResult(result))
      if (result.blockedNodes?.some(({ code }) =>
        code === 'quota_exhausted' || code === 'QUOTA_EXHAUSTED')) {
        setPipelineQuotaOpen(true)
      }
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
      pipelineInFlightRef.current = false
      setPipelineSubmitting(false)
    }
  }

  function toggleLane(laneKey: string): void {
    setCollapsedLanes((current) => {
      const next = new Set(current)
      if (next.has(laneKey)) next.delete(laneKey)
      else next.add(laneKey)
      return next
    })
  }

  return (
    <div ref={canvasRootRef} className="flex min-h-0 flex-1 bg-ds-canvas text-ds-text">
      <section className="relative flex min-w-0 flex-1 flex-col">
        <CanvasAutoHideTopBar
          title={projectTitle}
          meta={`${liveNodes.length} 节点 · ${projectExecutionLabel(execution.state)}`}
          actions={
            <CanvasExecutionActions
              action={action}
              billing={billing}
              projectId={projectId}
              submitting={pipelineSubmitting}
              websiteProject={websiteProject}
              onToggle={() => void togglePipeline()}
            />
          }
        />
        {visibleFeedback && (
          <div
            data-slot="pipeline-feedback"
            className="pointer-events-none absolute right-3 top-14 z-20 max-w-[calc(100%-1.5rem)] sm:right-4 sm:max-w-[calc(100%-2rem)]"
          >
            <Toast
              variant={visibleFeedback.variant}
              title={visibleFeedback.title}
              body={visibleFeedback.body}
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
          <QueueStatusBar
            variant="glass"
            className="absolute inset-x-3 bottom-3 z-10"
            {...queueCounts}
            label={queueBarLabel(execution, concurrency)}
          />
        </div>
      </section>
      <CanvasInspector
        projectId={projectId}
        node={selectedNode}
        execution={execution}
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
