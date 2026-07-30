'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock3, Sparkles, TriangleAlert } from 'lucide-react'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import type {
  CanvasGraphNode,
  DirectorNodeError,
  RenderNodeError,
  WorkflowExecutionNotice,
} from '@/features/canvas'
import { useHydrated } from '@/lib/hooks/use-hydrated'
import { useStageStream } from '@/lib/hooks/use-stage-stream'
import type { SkipKind } from '@/features/director/skip-policy'
import { SkipNodeDialog } from './skip-node-dialog'
import { StageErrorDialog } from './stage-error-dialog'

const STREAMABLE = new Set<CanvasGraphNode['status']>([
  'pending',
  'running',
  'success',
  'failed',
])

/** `渲染` 不是真实 PipelineStage，只是渲染失败在 UI 上的可读标签。 */
const RENDER_STAGE_LABEL = '渲染'

export interface StreamingLogCardProps {
  projectId: string
  nodeId: string
  status: CanvasGraphNode['status']
  stage: string | null
  /** 服务端已持久化的 HTML 生成（FABRICATE）失败信息（failed 态权威来源，刷新不丢）。 */
  directorError?: DirectorNodeError
  /** 服务端已持久化的渲染（Playwright/ffmpeg）失败信息；与 `directorError` 互斥。 */
  renderError?: RenderNodeError
  executionNotice?: WorkflowExecutionNotice
  /** 重试：重新入队该阶段。 */
  onRetry: () => void
  retrying?: boolean
  /** 跳过语义；未提供时不渲染跳过入口。 */
  skipKind?: SkipKind
  /** 确认跳过：携带必填原因调 intent=skip。 */
  onSkip?: (reason: string) => void
  onCancelWait?: () => void
}

/**
 * 决定 failed 态下向用户展示哪一条失败信息。
 *
 * `shot-codegen` 节点的失败来源不唯一：HTML 生成（`fabricateShot`，写
 * `directorError`）与渲染执行（Playwright/ffmpeg，写 `renderError`）是两条
 * 独立的补偿路径，写入时各自会清掉对方的残留标记，因此同一时刻至多一个非空。
 * 优先级：持久化的 `directorError` > 持久化的 `renderError` > 实时流错误
 * （`directorError` 权威、`renderError` 无实时流对应，`streamError` 仅用于
 * 尚未落盘前的即时反馈）。
 */
export function resolveVisibleStageError(
  status: CanvasGraphNode['status'],
  persistedError: DirectorNodeError | undefined,
  persistedRenderError: RenderNodeError | undefined,
  streamError: DirectorNodeError | undefined
): DirectorNodeError | undefined {
  if (status !== 'failed') return undefined
  if (persistedError) return persistedError
  if (persistedRenderError) {
    return {
      ...persistedRenderError,
      stage: RENDER_STAGE_LABEL,
    }
  }
  return streamError
}

/**
 * 分镜/阶段 AI 流式输出卡片（业务组合，不登记 /playbook）。
 * 复用 `CollapsibleCard` + `useStageStream`：实时追加 token、显示真实字符数与
 * 运行指示；失败时汇入 `StageErrorDialog` 持久化错误弹窗。
 */
export function StreamingLogCard({
  projectId,
  nodeId,
  status,
  stage,
  directorError,
  renderError,
  executionNotice,
  onRetry,
  retrying,
  skipKind,
  onSkip,
  onCancelWait,
}: StreamingLogCardProps) {
  const stream = useStageStream(projectId, nodeId, status)
  const error = resolveVisibleStageError(status, directorError, renderError, stream.error)
  const scrollRef = useRef<HTMLPreElement>(null)
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false)
  const [now, setNow] = useState(0)
  const hydrated = useHydrated()

  // 失败态自动弹一次错误弹窗：以「派生复位」实现（不在 effect 内同步 setState）。
  // autoKey 随节点或其失败原因变化；用户关闭后 key 不变故不重复自动弹，
  // 重跑成功（离开 failed）或换节点时 key 变化再复位。
  const autoKey = status === 'failed' && error ? `${nodeId}:${error.message}` : `${nodeId}:ok`
  const [dialog, setDialog] = useState({ key: '', open: false })
  if (dialog.key !== autoKey) {
    setDialog({ key: autoKey, open: status === 'failed' && !!error })
  }
  const dialogOpen = dialog.open
  const setDialogOpen = (open: boolean): void => setDialog({ key: autoKey, open })

  useEffect(() => {
    if (stream.streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [stream.text, stream.streaming])

  useEffect(() => {
    if (!executionNotice) return
    const frame = window.requestAnimationFrame(() => setNow(Date.now()))
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearInterval(timer)
    }
  }, [executionNotice])

  if (!STREAMABLE.has(status) || (status === 'pending' && !executionNotice)) return null

  const meta = stream.streaming ? (
    <span className="flex items-center gap-1">
      <span className="size-1.5 animate-pulse rounded-full bg-ds-blue" />
      {stream.charCount} 字
    </span>
  ) : (
    `${stream.charCount} 字`
  )

  return (
    <>
      <CollapsibleCard title="AI 流式输出" icon={Sparkles} meta={meta} defaultOpen className="w-full">
        {stream.text ? (
          <pre
            ref={scrollRef}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ds-text-muted"
          >
            {stream.text}
          </pre>
        ) : (
          <p className="text-[13px] text-ds-text-muted">
            {stream.streaming ? '正在连接 AI 流…' : '本阶段暂无流式输出'}
          </p>
        )}
        {stream.truncated && (
          <p className="mt-1 text-[11px] text-ds-text-muted">（日志过长，仅显示最近部分）</p>
        )}
        {error && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-ds-red-soft px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ds-red">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {error.stage === RENDER_STAGE_LABEL ? '渲染失败' : '阶段失败'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="shrink-0 text-[12px] font-medium text-ds-red transition-colors duration-fast ease-standard hover:opacity-80"
            >
              查看错误详情
            </button>
          </div>
        )}
        {executionNotice && (
          <div className="mt-2 rounded-md border border-ds-border bg-ds-blue-soft px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[12px] text-ds-text">
                <Clock3 className="size-4 shrink-0 text-ds-blue" />
                <span className="truncate">{executionNotice.message}</span>
              </span>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="shrink-0 text-[12px] font-medium text-ds-blue hover:underline"
              >
                {hydrated && now > 0
                  ? formatCountdown(executionNotice.resumeAt, now)
                  : '等待自动恢复'}
              </button>
            </div>
          </div>
        )}
      </CollapsibleCard>
      <StageErrorDialog
        open={dialogOpen}
        projectId={projectId}
        stage={error?.stage ?? stage ?? ''}
        message={error?.message ?? ''}
        errorCode={error?.code}
        origin={error?.origin ?? (executionNotice
          ? executionNotice.code === 'PLAN_CONCURRENCY_WAIT' ? 'user' : 'provider'
          : undefined)}
        title={error?.title ?? noticeTitle(executionNotice)}
        recovery={error?.recovery ?? (executionNotice ? 'auto_wait' : undefined)}
        provider={error?.provider ?? (executionNotice?.providerLabel
          ? {
              id: 'provider',
              label: executionNotice.providerLabel,
              retryAt: executionNotice.resumeAt,
            }
          : undefined)}
        referenceId={error?.referenceId}
        occurredAt={error?.occurredAt}
        onClose={() => setDialogOpen(false)}
        onRetry={() => {
          setDialogOpen(false)
          onRetry()
        }}
        retrying={retrying}
        retryable={error?.retryable !== false}
        onCancelWait={executionNotice ? onCancelWait : undefined}
        {...(skipKind && onSkip
          ? {
              onSkip: () => {
                setDialogOpen(false)
                setSkipConfirmOpen(true)
              },
            }
          : {})}
      />
      <SkipNodeDialog
        open={skipConfirmOpen}
        stage={error?.stage ?? stage ?? ''}
        skipKind={skipKind ?? 'output-degradation'}
        onClose={() => setSkipConfirmOpen(false)}
        onConfirm={(reason) => {
          setSkipConfirmOpen(false)
          onSkip?.(reason)
        }}
        submitting={retrying}
      />
    </>
  )
}

function noticeTitle(
  notice: WorkflowExecutionNotice | undefined,
): string | undefined {
  if (!notice) return undefined
  if (notice.code === 'PLAN_CONCURRENCY_WAIT') return '套餐分镜并发已满'
  if (notice.code === 'PROVIDER_POOL_WAIT') return '正在等待可用调用窗口'
  return '服务繁忙，系统已自动排队'
}

function formatCountdown(resumeAt: string, now: number): string {
  const remaining = Math.max(0, Date.parse(resumeAt) - now)
  if (!Number.isFinite(remaining) || remaining === 0) return '即将自动恢复'
  const seconds = Math.ceil(remaining / 1_000)
  return `约 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 后继续`
}
