'use client'

import { SkipForward } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextArea } from '@/components/ui/text-area'
import {
  SKIP_REASON_MAX_LENGTH,
  SKIP_REASON_MIN_LENGTH,
  type SkipKind,
} from '@/features/director/skip-policy'

export interface SkipNodeDialogProps {
  open: boolean
  /** 被跳过的环节标签（如 FABRICATE / 渲染），仅用于标题呈现。 */
  stage: string
  skipKind: SkipKind
  onClose: () => void
  onConfirm: (reason: string) => void
  submitting?: boolean
}

/** 跳过原因是否满足服务端合同（1-200 字，trim 后计）。 */
export function isValidSkipReason(reason: string): boolean {
  const trimmed = reason.trim()
  return (
    trimmed.length >= SKIP_REASON_MIN_LENGTH &&
    trimmed.length <= SKIP_REASON_MAX_LENGTH
  )
}

export function getSkipDialogCopy(skipKind: SkipKind): {
  description: string
  placeholder: string
} {
  if (skipKind === 'qa-waiver') {
    return {
      description:
        '跳过后不会标记验收通过；该分镜将记为未验收，成片只能通过显式降级导出交付。可稍后重新执行恢复。请填写豁免原因。',
      placeholder: '例如：接受当前镜头风险，先继续完成降级交付',
    }
  }
  return {
    description:
      '跳过后将以占位/缺省产出继续（画面黑场、无音效或无字幕），可稍后在节点上重新执行恢复。请填写跳过原因。',
    placeholder: '例如：素材缺失，先用占位继续整片装配',
  }
}

/**
 * 跳过环节的二次确认弹窗（业务组合，复用已登记的 `Dialog`/`TextArea` 原语）。
 * 明示占位后果与恢复路径，原因必填（routing.md 跳过合同：1-200 字）。
 */
export function SkipNodeDialog({
  open,
  stage,
  skipKind,
  onClose,
  onConfirm,
  submitting,
}: SkipNodeDialogProps) {
  const [reason, setReason] = useState('')
  const copy = getSkipDialogCopy(skipKind)
  const close = (): void => {
    setReason('')
    onClose()
  }
  return (
    <Dialog
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <SkipForward className="size-5 shrink-0 text-ds-text-muted" />
          {stage ? `跳过 ${stage} 环节？` : '跳过此环节？'}
        </span>
      }
      description={copy.description}
      actions={
        <>
          <Button variant="gray" onClick={close}>
            取消
          </Button>
          <Button
            variant="tinted"
            icon={SkipForward}
            onClick={() => onConfirm(reason.trim())}
            disabled={submitting || !isValidSkipReason(reason)}
          >
            确认跳过
          </Button>
        </>
      }
    >
      <TextArea
        label={`跳过原因（必填，${SKIP_REASON_MIN_LENGTH}-${SKIP_REASON_MAX_LENGTH} 字）`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={SKIP_REASON_MAX_LENGTH}
        placeholder={copy.placeholder}
        className="w-full"
      />
    </Dialog>
  )
}
