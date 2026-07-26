'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import type {
  CanvasGraphNode,
  DirectorNodeError,
  RenderNodeError,
} from '@/features/canvas'
import { useStageStream } from '@/lib/hooks/use-stage-stream'
import { StageErrorDialog } from './stage-error-dialog'

const STREAMABLE = new Set<CanvasGraphNode['status']>(['running', 'success', 'failed'])

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
  /** 重试：重新入队该阶段。 */
  onRetry: () => void
  retrying?: boolean
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
      stage: RENDER_STAGE_LABEL,
      message: persistedRenderError.message,
      retryable: persistedRenderError.retryable,
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
  onRetry,
  retrying,
}: StreamingLogCardProps) {
  const stream = useStageStream(projectId, nodeId, status)
  const error = resolveVisibleStageError(status, directorError, renderError, stream.error)
  const scrollRef = useRef<HTMLPreElement>(null)

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

  if (!STREAMABLE.has(status)) return null

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
              className="shrink-0 text-[12px] font-medium text-ds-red transition-colors hover:opacity-80"
            >
              查看错误详情
            </button>
          </div>
        )}
      </CollapsibleCard>
      <StageErrorDialog
        open={dialogOpen}
        stage={error?.stage ?? stage ?? ''}
        message={error?.message ?? ''}
        onClose={() => setDialogOpen(false)}
        onRetry={() => {
          setDialogOpen(false)
          onRetry()
        }}
        retrying={retrying}
        retryable={error?.retryable !== false}
      />
    </>
  )
}
