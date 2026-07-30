'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextArea } from '@/components/ui/text-area'
import { SHOT_REVISION_BRIEF_MAX_LENGTH } from '@/features/canvas/contracts'

export interface ShotRevisionDialogProps {
  disabled?: boolean
  onConfirm: (revisionBrief: string) => Promise<boolean>
}

export function isValidShotRevisionBrief(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= SHOT_REVISION_BRIEF_MAX_LENGTH
}

/** 单镜定向修改组合：复用 Canonical Dialog、TextArea 与 Button。 */
export function ShotRevisionDialog({ disabled, onConfirm }: ShotRevisionDialogProps) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState('')

  function close() {
    if (disabled) return
    setOpen(false)
    setBrief('')
  }

  async function confirm() {
    const normalized = brief.trim()
    if (!isValidShotRevisionBrief(normalized)) return
    if (await onConfirm(normalized)) {
      setOpen(false)
      setBrief('')
    }
  }

  return (
    <>
      <Button
        variant="tinted"
        size="sm"
        icon={Sparkles}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        修改
      </Button>
      <Dialog
        open={open}
        onClose={close}
        placement="center"
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="text-ds-blue size-5" />
            定向修改当前镜头
          </span>
        }
        description="用一句话说明希望调整的画面。AI 会读取当前完整 HTML，只改与要求直接相关的部分；镜头事实、时长与确定性校验保持不变。"
        actions={
          <>
            <Button variant="gray" onClick={close} disabled={disabled}>
              取消
            </Button>
            <Button
              variant="tinted"
              icon={Sparkles}
              onClick={() => void confirm()}
              disabled={disabled || !isValidShotRevisionBrief(brief)}
            >
              生成新版
            </Button>
          </>
        }
      >
        <TextArea
          autoFocus
          label={`修改要求（必填，最多 ${SHOT_REVISION_BRIEF_MAX_LENGTH} 字）`}
          value={brief}
          maxLength={SHOT_REVISION_BRIEF_MAX_LENGTH}
          placeholder="例如：主视觉改成俯视构图，标题更克制"
          className="w-full"
          onChange={(event) => setBrief(event.target.value)}
        />
      </Dialog>
    </>
  )
}
