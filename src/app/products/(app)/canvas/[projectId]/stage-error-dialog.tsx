'use client'

import { CircleX, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

export interface StageErrorDialogProps {
  open: boolean
  /** 失败阶段（如 INGEST / DIRECT）。 */
  stage: string
  /** 服务端记录的真实失败原因（canvas_nodes.data.directorError.message）。 */
  message: string
  onClose: () => void
  onRetry: () => void
  retrying?: boolean
}

/**
 * 阶段失败的持久化错误弹窗（业务组合，复用已登记的 `Dialog` 原语）。
 * 内容取自 DB 的 `directorError`（刷新不丢），非自动消失；仅在真实失败时呈现。
 */
export function StageErrorDialog({
  open,
  stage,
  message,
  onClose,
  onRetry,
  retrying,
}: StageErrorDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <CircleX className="h-5 w-5 shrink-0 text-danger" />
          {stage ? `${stage} 阶段失败` : '阶段执行失败'}
        </span>
      }
      description="AI 执行该阶段时报错，以下为服务端记录的失败原因。"
      actions={
        <>
          <Button variant="gray" onClick={onClose}>
            关闭
          </Button>
          <Button variant="tinted" icon={RefreshCw} onClick={onRetry} disabled={retrying}>
            重试
          </Button>
        </>
      }
    >
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-danger">
        {message || '（无错误详情）'}
      </pre>
    </Dialog>
  )
}
