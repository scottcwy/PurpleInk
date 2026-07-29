'use client'

import Link from 'next/link'
import { ChevronRight, FileCode, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { Toast } from '@/components/ui/toast'
import type { CanvasGraphNode } from '@/features/canvas'
import { ArtifactHoverChip } from '@/features/canvas/artifact-hover-chip'
import { AnimatedAside, DrawerOverlay } from '@/features/navigation/collapsible-panel'
import {
  productExportHref,
  productShotHref,
} from '@/features/navigation/products-routes'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { usePersistentToggle } from '@/lib/hooks/use-persistent-toggle'
import { useResizablePanel } from '@/lib/hooks/use-resizable-panel'
import { BP_SECONDARY_PANEL_COLLAPSE, INSPECTOR_DEFAULT_WIDTH, INSPECTOR_MAX_WIDTH, INSPECTOR_MIN_WIDTH } from '@/lib/layout/breakpoints'
import { cn } from '@/lib/utils'
import {
  BillingQuotaExhaustedError,
  triggerCancelProviderWait,
  triggerNodeAction,
  triggerNodeSkip,
  type NodeActionResult,
} from './canvas-action-api'
import { getNodeStatusLabel, getNodeStatusPresentation } from './flow-elements'
import { isNodeActionBlocked, nodeActionLabel } from './node-action-presentation'
import { StreamingLogCard } from './streaming-log-card'
import { skipKindForNodeType } from '@/features/director/skip-policy'

export function CanvasInspector({
  projectId,
  node,
  onQueued,
  onQuotaExhausted,
}: {
  projectId: string
  node?: CanvasGraphNode
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

  useEffect(() => {
    if (!overlayOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOverlayRequested(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])

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
        width={collapsed ? 32 : width}
        animateWidth={!isDragging}
        className="flex h-full flex-col border-l border-ds-border bg-ds-surface text-ds-text"
      >
        {collapsed ? (
          <div className="flex flex-col items-center py-3">
            <IconButton
              icon={ChevronRight}
              aria-label={overlayOpen ? '关闭分镜合同' : '展开分镜合同'}
              className={overlayOpen ? undefined : '[&>svg]:rotate-180'}
              onClick={() => {
                if (overlayOpen) setOverlayRequested(false)
                else if (autoCollapse) setOverlayRequested(true)
                else setManualCollapsed(false)
              }}
            />
          </div>
        ) : (
          body
        )}
      </AnimatedAside>
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

function EmptyInspector({
  onCollapse,
  showCollapse,
}: {
  onCollapse: () => void
  showCollapse: boolean
}) {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-ds-text-muted">分镜合同</p>
        {showCollapse && (
          <IconButton
            icon={ChevronRight}
            aria-label="收起分镜合同"
            onClick={onCollapse}
          />
        )}
      </div>
    </div>
  )
}

function InspectorBody({
  node,
  projectId,
  submitting,
  error,
  queuedFeedback,
  onExecute,
  onSkip,
  onCancelWait,
  onCollapse,
  showCollapse,
}: {
  node: CanvasGraphNode
  projectId: string
  submitting: boolean
  error?: string
  queuedFeedback?: { jobId: string; message: string }
  onExecute: () => void
  onSkip: (reason: string) => void
  onCancelWait: () => void
  onCollapse: () => void
  showCollapse: boolean
}) {
  const status = getNodeStatusPresentation(node.status)
  return (
    <div className={cn('flex h-full flex-col gap-4 overflow-auto p-4')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-[17px] font-semibold">
          {node.laneKey ?? NODE_LABEL[node.type]}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill variant={status.variant} label={getNodeStatusLabel(node.type, node.status)} />
          {showCollapse && (
            <IconButton
              icon={ChevronRight}
              aria-label="收起分镜合同"
              onClick={onCollapse}
            />
          )}
        </div>
      </div>
      <div className="flex h-40 items-center justify-center rounded-md bg-ds-surface-muted">
        <FileCode className="size-10 text-ds-text-muted" />
      </div>
      <SettingsGroup>
        <SettingsRow label="节点类型" value={node.type} />
        <SettingsSeparator />
        <SettingsRow label="执行阶段" value={node.stage ?? '未配置'} />
        <SettingsSeparator />
        <SettingsRow
          label="内容哈希"
          value={node.contentHash ? node.contentHash.slice(0, 12) : '待生成'}
        />
      </SettingsGroup>
      <div>
        <p className="mb-2 text-[13px] font-semibold text-ds-text-muted">关联产物</p>
        {node.artifacts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {node.artifacts.map((artifact) => (
              <ArtifactHoverChip
                key={artifact.id}
                artifactId={artifact.id}
                kind={artifact.kind}
                filename={ARTIFACT_FILENAME[artifact.kind] ?? artifact.filename}
                projectId={projectId}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ds-text-muted">暂无产物</p>
        )}
      </div>
      <StreamingLogCard
        projectId={projectId}
        nodeId={node.id}
        status={node.status}
        stage={node.stage}
        directorError={node.directorError}
        renderError={node.renderError}
        executionNotice={node.executionNotice}
        onRetry={onExecute}
        retrying={submitting}
        skipKind={skipKindForNodeType(node.type) ?? undefined}
        onSkip={onSkip}
        onCancelWait={onCancelWait}
      />
      {node.type === 'export' && node.status === 'blocked' ? (
        <Link href={productExportHref(projectId)}>
          <Button variant="tinted">{nodeActionLabel(node)}</Button>
        </Link>
      ) : (
        <Button
          variant={node.type === 'shot-codegen' ? 'destructive' : 'tinted'}
          icon={RefreshCw}
          onClick={onExecute}
          disabled={submitting || isNodeActionBlocked(node)}
        >
          {nodeActionLabel(node)}
        </Button>
      )}
      {node.type === 'shot-codegen' && (
        <Link href={productShotHref(node.id, projectId)}>
          <Button variant="gray">查看代码</Button>
        </Link>
      )}
      {queuedFeedback && (
        <Toast
          variant="info"
          title="已入队"
          body={`${queuedFeedback.message}（作业 ${queuedFeedback.jobId}）`}
          className="w-full"
        />
      )}
      {error && <Toast variant="error" title="失败" body={error} className="w-full" />}
    </div>
  )
}

/** 已知产物 kind 的展示层友好文件名；真实 key 内含内容哈希，直接展示会破坏布局。 */
const ARTIFACT_FILENAME: Record<string, string> = {
  'director-ingest': 'script-units.json',
  'director-direct': 'style-bible.md',
  'director-shot-spec': 'shot-plan.json',
  'director-fabricate': 'shot.html',
  'director-assemble': 'assemble-plan.json',
  'director-finalize': 'finalize-report.json',
  'voiceover-audio': 'voiceover.mp3',
  'voiceover-metadata': 'voiceover-metadata.json',
  'subtitle-track': 'subtitle-track.json',
  'qa-vision-report': 'vision-qa-report.json',
  'render-mp4': 'render.mp4',
  'final-mp4': 'final.mp4',
}

const NODE_LABEL: Record<CanvasGraphNode['type'], string> = {
  'script-import': 'Ingest 语义分镜',
  'shot-split': 'Direct 风格圣经',
  score: 'Assemble 合成',
  export: 'Finalize 导出',
  'shot-script': 'Shot-Spec 分镜合同',
  'shot-codegen': 'Shot 分镜节点',
  'shot-sfx': 'Audio 配音字幕',
  'shot-subtitle': 'Audio 配音字幕',
  'shot-qa': 'Finalize 验收',
}
