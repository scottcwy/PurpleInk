'use client'

import { useReactFlow, useStore } from '@xyflow/react'
import { useState, type RefObject } from 'react'
import {
  ContextMenu,
  type ContextMenuPosition,
} from '@/components/ui/context-menu'
import type { CanvasGraphNode } from '@/features/canvas'
import { useFullscreen } from '@/lib/hooks/use-fullscreen'
import {
  BillingQuotaExhaustedError,
  triggerCancelProviderWait,
  triggerNodeAction,
  type NodeActionResult,
} from './canvas-action-api'
import {
  buildNodeMenuItems,
  buildPaneMenuItems,
} from './canvas-context-menu-items'
import type { PipelineFeedback } from './pipeline-feedback'

export type CanvasMenuTarget =
  | { kind: 'pane'; position: ContextMenuPosition }
  | { kind: 'node'; nodeId: string; position: ContextMenuPosition }

export interface CanvasContextMenuProps {
  projectId: string
  nodes: readonly CanvasGraphNode[]
  target: CanvasMenuTarget | null
  onClose: () => void
  /** 入队成功后的收敛（沿用画布既有的 router.refresh）。 */
  onQueued: () => void
  onQuotaExhausted: () => void
  onFeedback: (feedback: PipelineFeedback) => void
  /** 全屏目标：画布页根容器。 */
  fullscreenTargetRef: RefObject<HTMLDivElement | null>
}

/**
 * 画布右键菜单。必须挂在 `<ReactFlow>` 内部才能取到视口能力（useReactFlow / useStore）；
 * 菜单本体由 ContextMenu portal 到 body，所以 DOM 位置不影响呈现。
 *
 * 节点操作复用 inspector 的同一批 API 客户端，不新增任何后端能力。
 */
export function CanvasContextMenu({
  projectId,
  nodes,
  target,
  onClose,
  onQueued,
  onQuotaExhausted,
  onFeedback,
  fullscreenTargetRef,
}: CanvasContextMenuProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const minZoomReached = useStore((state) => state.transform[2] <= state.minZoom)
  const maxZoomReached = useStore((state) => state.transform[2] >= state.maxZoom)
  const fullscreen = useFullscreen()
  const [submitting, setSubmitting] = useState(false)

  async function run(
    node: CanvasGraphNode,
    task: (target: CanvasGraphNode) => Promise<NodeActionResult>,
  ): Promise<void> {
    setSubmitting(true)
    try {
      const result = await task(node)
      onFeedback({
        variant: 'success',
        title: '已入队',
        body: `${result.message}（作业 ${result.jobId}）`,
      })
      onQueued()
    } catch (error) {
      if (error instanceof BillingQuotaExhaustedError) onQuotaExhausted()
      onFeedback({
        variant: 'error',
        title: '节点操作失败',
        body: error instanceof Error ? error.message : '作业入队失败',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const node =
    target?.kind === 'node'
      ? nodes.find(({ id }) => id === target.nodeId)
      : undefined

  const items =
    target?.kind === 'node' && node
      ? buildNodeMenuItems(
          node,
          {
            onRerender: () => void run(node, (n) => triggerNodeAction(projectId, n)),
            onStop: () =>
              void run(node, (n) => triggerCancelProviderWait(projectId, n)),
            onCancel: onClose,
          },
          submitting,
        )
      : buildPaneMenuItems(
          {
            minZoomReached,
            maxZoomReached,
            isFullscreen: fullscreen.isFullscreen,
            fullscreenSupported: fullscreen.supported,
          },
          {
            onZoomIn: () => zoomIn({ duration: 200 }),
            onZoomOut: () => zoomOut({ duration: 200 }),
            onFitView: () => fitView({ padding: 0.15, duration: 200 }),
            onToggleFullscreen: () => {
              if (fullscreen.isFullscreen) fullscreen.exit()
              else fullscreen.enter(fullscreenTargetRef.current)
            },
          },
        )

  return (
    <ContextMenu
      open={target !== null}
      position={target?.position ?? null}
      items={items}
      ariaLabel={target?.kind === 'node' ? '节点操作' : '画布视图'}
      onClose={onClose}
    />
  )
}
