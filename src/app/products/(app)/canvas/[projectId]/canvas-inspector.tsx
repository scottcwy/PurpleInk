'use client'

import { Settings } from 'lucide-react'
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { IconButton } from '@/components/ui/icon-button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import type { CanvasGraphNode } from '@/features/canvas'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import { AnimatedAside, DrawerOverlay } from '@/features/navigation/collapsible-panel'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import { useResizablePanel } from '@/lib/hooks/use-resizable-panel'
import {
  SPRING_SPATIAL_FAST,
  TRANSITION_BASE,
  TRANSITION_EXIT,
} from '@/lib/motion/tokens'
import { BP_SECONDARY_PANEL_COLLAPSE, INSPECTOR_DEFAULT_WIDTH, INSPECTOR_MAX_WIDTH, INSPECTOR_MIN_WIDTH } from '@/lib/layout/breakpoints'
import { cn } from '@/lib/utils'
import {
  BillingQuotaExhaustedError,
  triggerCancelProviderWait,
  triggerNodeAction,
  triggerNodeSkip,
  type NodeActionResult,
} from './canvas-action-api'
import { EmptyInspector, InspectorBody } from './canvas-inspector-body'

export function CanvasInspector({
  projectId,
  node,
  execution,
  onQueued,
  onQuotaExhausted,
}: {
  projectId: string
  node?: CanvasGraphNode
  execution: ProjectExecutionSnapshot
  onQueued: (jobId: string) => void
  onQuotaExhausted: () => void
}) {
  const [error, setError] = useState<{ nodeId: string; message: string }>()
  const [queuedJob, setQueuedJob] =
    useState<{ nodeId: string; jobId: string; message: string }>()
  const [submitting, setSubmitting] = useState(false)
  const autoCollapse = useMediaQuery(`(max-width: ${BP_SECONDARY_PANEL_COLLAPSE - 1}px)`)
  const [manualCollapsed, setManualCollapsed] = usePersistentToggle(
    'cvc:inspector-collapsed',
    false,
  )
  const { width, isDragging, handlePointerDown, setWidth } = useResizablePanel({
    storageKey: 'cvc:inspector-width',
    defaultWidth: INSPECTOR_DEFAULT_WIDTH,
    min: INSPECTOR_MIN_WIDTH,
    max: INSPECTOR_MAX_WIDTH,
    invert: true,
  })
  const [overlayRequested, setOverlayRequested] = useState(false)

  const collapsed = autoCollapse || manualCollapsed
  const overlayOpen = collapsed && overlayRequested

  async function run(task: (target: CanvasGraphNode) => Promise<NodeActionResult>) {
    if (!node) return
    setSubmitting(true)
    setError(undefined)
    setQueuedJob(undefined)
    try {
      const result = await task(node)
      setQueuedJob({
        nodeId: node.id,
        jobId: result.jobId,
        message: result.message,
      })
      onQueued(result.jobId)
    } catch (cause) {
      if (cause instanceof BillingQuotaExhaustedError) {
        onQuotaExhausted()
      }
      setError({
        nodeId: node.id,
        message: cause instanceof Error ? cause.message : '作业入队失败',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const queuedFeedback =
    node && queuedJob?.nodeId === node.id ? queuedJob : undefined

  const body = node ? (
    <InspectorBody
      node={node}
      projectId={projectId}
      execution={execution}
      submitting={submitting}
      error={error?.nodeId === node.id ? error.message : undefined}
      queuedFeedback={queuedFeedback}
      onExecute={() => run((target) => triggerNodeAction(projectId, target))}
      onSkip={(reason) => run((target) => triggerNodeSkip(projectId, target, reason))}
      onCancelWait={() => run((target) => triggerCancelProviderWait(projectId, target))}
      onCollapse={() => {
        setManualCollapsed(true)
        setOverlayRequested(false)
      }}
      showCollapse={!autoCollapse}
    />
  ) : (
    <EmptyInspector
      onCollapse={() => {
        setManualCollapsed(true)
        setOverlayRequested(false)
      }}
      showCollapse={!autoCollapse}
    />
  )

  return (
    <div className="relative flex h-full shrink-0">
      <AnimatedAside
        width={collapsed ? 0 : width}
        animateWidth={!isDragging}
        className={cn(
          'flex h-full flex-col bg-ds-surface text-ds-text',
          !collapsed && 'border-l border-ds-border',
        )}
      >
        {!collapsed && body}
      </AnimatedAside>
      <AnimatePresence>
        {collapsed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { default: SPRING_SPATIAL_FAST, opacity: TRANSITION_BASE },
            }}
            exit={{ opacity: 0, scale: 0.96, transition: TRANSITION_EXIT }}
            className="absolute right-3 top-3 z-10"
          >
            <IconButton
              icon={Settings}
              aria-label={overlayOpen ? '关闭分镜合同' : '展开分镜合同'}
              className="size-10 rounded-full bg-ds-surface/90 shadow-[var(--ds-shadow)] backdrop-blur-xl"
              onClick={() => {
                if (overlayOpen) setOverlayRequested(false)
                else if (autoCollapse) setOverlayRequested(true)
                else setManualCollapsed(false)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {!collapsed && (
        <ResizeHandle
          className="absolute inset-y-0 left-0"
          isDragging={isDragging}
          onPointerDown={handlePointerDown}
          onKeyAdjust={(delta) => setWidth(width - delta)}
          aria-label="调节分镜合同宽度"
        />
      )}
      <DrawerOverlay
        open={overlayOpen}
        onDismiss={() => setOverlayRequested(false)}
        side="right"
        scrimLabel="关闭分镜合同遮罩"
        className="flex"
        style={{ width }}
      >
        <ResizeHandle
          isDragging={isDragging}
          onPointerDown={handlePointerDown}
          onKeyAdjust={(delta) => setWidth(width - delta)}
          aria-label="调节分镜合同宽度"
        />
        <div className="min-w-0 flex-1 overflow-auto border-l border-ds-border bg-ds-surface text-ds-text">
          {body}
        </div>
      </DrawerOverlay>
    </div>
  )
}
