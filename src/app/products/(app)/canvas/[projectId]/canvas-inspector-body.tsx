'use client'

import Link from 'next/link'
import { ChevronRight, FileCode, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SettingsGroup, SettingsSeparator } from '@/components/ui/settings-group'
import { SettingsRow } from '@/components/ui/settings-row'
import { StatusPill } from '@/components/ui/status-pill'
import { Toast } from '@/components/ui/toast'
import type { CanvasGraphNode } from '@/features/canvas'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import { ArtifactHoverChip } from '@/features/canvas/artifact-hover-chip'
import {
  productExportHref,
  productShotHref,
} from '@/features/navigation/products-routes'
import { cn } from '@/lib/utils'
import { ARTIFACT_FILENAME, NODE_LABEL } from './canvas-inspector-labels'
import { getNodeStatusLabel, getNodeStatusPresentation } from './flow-elements'
import { isNodeActionBlocked, nodeActionLabel } from './node-action-presentation'
import { StreamingLogCard } from './streaming-log-card'
import { WebsiteStageInspector } from './website-stage-inspector'
import { websiteStagePresentation } from '@/features/projects/website-execution-presentation'
import { skipKindForNodeType } from '@/features/director/skip-policy'

export function EmptyInspector({
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

export function InspectorBody({
  node,
  projectId,
  execution,
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
  execution: ProjectExecutionSnapshot
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
  const websiteStageIndex = execution.stages.findIndex(
    (stage) => stage.nodeId === node.id,
  )
  const websiteStage = websiteStageIndex >= 0
    ? execution.stages[websiteStageIndex]
    : undefined
  const websitePresentation = websiteStage
    ? websiteStagePresentation(execution, websiteStage, websiteStageIndex)
    : undefined
  return (
    <div className={cn('flex h-full flex-col gap-4 overflow-auto p-4')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-[17px] font-semibold">
          {websitePresentation?.title ?? node.laneKey ?? NODE_LABEL[node.type]}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill
            variant={status.variant}
            label={websitePresentation?.status
              ?? getNodeStatusLabel(node.type, node.status)}
          />
          {showCollapse && (
            <IconButton
              icon={ChevronRight}
              aria-label="收起分镜合同"
              onClick={onCollapse}
            />
          )}
        </div>
      </div>
      {node.type === 'website-stage' ? (
        <WebsiteStageInspector node={node} execution={execution} />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md bg-ds-surface-muted">
          <FileCode className="size-10 text-ds-text-muted" />
        </div>
      )}
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
