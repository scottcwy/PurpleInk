'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { CollapsibleCard } from '@/components/ui/collapsible-card'
import type { CanvasGraphNode, DirectorNodeError } from '@/features/canvas'
import { useStageStream } from '@/lib/hooks/use-stage-stream'
import { StageErrorDialog } from './stage-error-dialog'

const STREAMABLE = new Set<CanvasGraphNode['status']>(['running', 'success', 'failed'])

export interface StreamingLogCardProps {
  projectId: string
  nodeId: string
  status: CanvasGraphNode['status']
  stage: string | null
  /** 服务端已持久化的失败信息（failed 态权威来源，刷新不丢）。 */
  directorError?: DirectorNodeError
  /** 重试：重新入队该阶段。 */
  onRetry: () => void
  retrying?: boolean
}

export function resolveVisibleStageError(
  status: CanvasGraphNode['status'],
  persistedError: DirectorNodeError | undefined,
  streamError: DirectorNodeError | undefined
): DirectorNodeError | undefined {
  if (status !== 'failed') return undefined
  return persistedError ?? streamError
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
  onRetry,
  retrying,
}: StreamingLogCardProps) {
  const stream = useStageStream(projectId, nodeId, status)
  const error = resolveVisibleStageError(status, directorError, stream.error)
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
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
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
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-label-secondary"
          >
            {stream.text}
          </pre>
        ) : (
          <p className="text-[13px] text-label-tertiary">
            {stream.streaming ? '正在连接 AI 流…' : '本阶段暂无流式输出'}
          </p>
        )}
        {stream.truncated && (
          <p className="mt-1 text-[11px] text-label-tertiary">（日志过长，仅显示最近部分）</p>
        )}
        {error && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-sm bg-danger-fill px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-danger">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">阶段失败</span>
            </span>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="shrink-0 text-[12px] font-medium text-danger transition-colors hover:opacity-80"
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
      />
    </>
  )
}
