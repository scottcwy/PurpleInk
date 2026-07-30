'use client'

import {
  Download,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { TopBar } from '@/components/ui/top-bar'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import {
  startPipeline,
  stopPipeline,
} from '@/features/projects/execution-control-client'
import { projectExecutionLabel } from '@/features/projects/website-execution-presentation'
import { useProjectExecution } from '@/features/projects/use-project-execution'
import { usePublishNavContext } from '@/features/navigation/nav-context'
import {
  websiteDeliveryForDownload,
  websiteExportAction,
  websiteExportProgress,
} from './website-export-model'
import { WebsiteDeliveryPreview } from './website-delivery-preview'
import { WebsiteExportStageList } from './website-export-stage-list'

export function WebsiteExportWorkspace({
  initialExecution,
  projectId,
  projectTitle,
}: {
  initialExecution: ProjectExecutionSnapshot
  projectId: string
  projectTitle: string
}) {
  const runtime = useProjectExecution(projectId, initialExecution)
  const execution = runtime.execution
  const action = websiteExportAction(execution)
  const delivery = websiteDeliveryForDownload(execution)
  const progress = websiteExportProgress(execution)
  const [feedback, setFeedback] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const inFlightRef = useRef(false)

  usePublishNavContext({ projectId })

  async function controlExecution() {
    if (inFlightRef.current || action.mode === 'busy' || action.mode === 'download') {
      return
    }
    inFlightRef.current = true
    setSubmitting(true)
    setFeedback(undefined)
    try {
      const result = action.mode === 'stop'
        ? await stopPipeline(projectId)
        : await startPipeline(projectId)
      runtime.adopt(result.execution)
      setFeedback(controlFeedback(result.status, result.execution.state))
    } catch {
      setFeedback('操作暂时失败，请稍后重试；后台状态不受页面同步影响')
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto text-ds-text">
      <TopBar
        title="网站视频交付"
        actions={
          <WebsitePrimaryAction
            action={action}
            deliveryUrl={delivery?.downloadUrl}
            disabled={submitting}
            onControl={() => void controlExecution()}
          />
        }
      />
      <div className="mx-auto grid w-full max-w-[1180px] gap-4 p-4 sm:p-6">
        <header className="rounded-xl border border-ds-border bg-ds-surface px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-ds-text-muted">{projectTitle}</p>
              <h1 className="mt-1 text-base font-semibold">
                {projectExecutionLabel(execution.state)}
              </h1>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium">{progress.label}</p>
              <p className="mt-1 text-[11px] text-ds-text-muted">
                {execution.currentStage
                  ? `当前：${currentStageLabel(execution)}`
                  : '当前没有运行中的阶段'}
              </p>
            </div>
          </div>
          {runtime.syncInterrupted && (
            <p className="mt-3 rounded-lg bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              状态同步暂时中断，后台任务不受影响
            </p>
          )}
          {feedback && (
            <p className="mt-3 rounded-lg bg-ds-surface-muted px-3 py-2 text-xs text-ds-text-muted">
              {feedback}
            </p>
          )}
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <WebsiteDeliveryPreview
            delivery={delivery}
            execution={execution}
            projectTitle={projectTitle}
          />
          <WebsiteExportStageList execution={execution} />
        </div>
      </div>
    </main>
  )
}

function WebsitePrimaryAction({
  action,
  deliveryUrl,
  disabled,
  onControl,
}: {
  action: ReturnType<typeof websiteExportAction>
  deliveryUrl?: string
  disabled: boolean
  onControl: () => void
}) {
  if (action.mode === 'download' && deliveryUrl) {
    return (
      <a href={deliveryUrl} target="_blank" rel="noreferrer">
        <Button size="sm" icon={Download}>{action.label}</Button>
      </a>
    )
  }
  const Icon = action.mode === 'stop'
    ? Square
    : action.mode === 'busy'
      ? RefreshCw
      : Play
  return (
    <Button
      size="sm"
      variant={action.mode === 'stop' ? 'gray' : undefined}
      icon={Icon}
      disabled={disabled || action.mode === 'busy' || action.mode === 'download'}
      onClick={onControl}
    >
      {action.mode === 'download' ? '交付校验中' : action.label}
    </Button>
  )
}

function currentStageLabel(execution: ProjectExecutionSnapshot): string {
  const stage = execution.stages.find(
    (candidate) => candidate.nodeId === execution.currentStage?.nodeId,
  )
  return stage
    ? websiteStageTitle(stage.phase)
    : websiteStageTitle(execution.currentStage!.phase)
}

function websiteStageTitle(
  phase: ProjectExecutionSnapshot['stages'][number]['phase'],
): string {
  return {
    capture: '网站采集',
    script: '介绍脚本',
    narration: '旁白生成',
    compose: '画面合成',
    render: '视频渲染',
    export: '成片验收与导出',
  }[phase]
}

function controlFeedback(
  status: string | undefined,
  state: ProjectExecutionSnapshot['state'],
): string {
  if (status === 'reused') return '已恢复现有任务'
  if (status === 'complete' || state === 'succeeded') return '成片已完成'
  if (status === 'blocked' || state === 'blocked') return '成片验收未通过'
  if (status === 'stopping') return '正在安全停止'
  if (status === 'stopped') return '项目已停止'
  return '任务已排队'
}
