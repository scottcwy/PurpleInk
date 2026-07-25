'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AudioLines, Plus, Sparkles, Timer, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import { createProjectAndStartIngest } from './new-project-api'

const SCRIPT_PLACEHOLDER =
  '你有没有想过，为什么大语言模型总是一本正经地胡说八道？这背后不是它"想骗人"，而是它的训练目标决定的——它只学会了"下一个词最可能是什么"。今天这支视频，我们用十分钟讲清楚 RAG：给模型配一本可以翻阅的参考书……'

export interface NewProjectDialogProps {
  featured?: boolean
}

export function NewProjectDialog({ featured = false }: NewProjectDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [script, setScript] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = !title.trim()
      ? '项目名称不能为空'
      : !script.trim()
        ? '请粘贴文字稿'
        : undefined
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const { projectId } = await createProjectAndStartIngest({ title, script })
      router.push(`/legacy/canvas?projectId=${encodeURIComponent(projectId)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <>
      {featured ? (
        <Button
          variant="gray"
          className="h-24 w-full flex-col gap-2 rounded-lg border border-separator bg-surface"
          onClick={() => setOpen(true)}
        >
          <Plus className="h-7 w-7 text-accent" />
          <span className="text-[17px] text-label-secondary">粘贴一段文字稿，开始创作</span>
          <span className="text-xs font-normal text-label-tertiary">
            支持导入 .txt / .md，可选上传配音作为时间地基
          </span>
        </Button>
      ) : (
        <Button icon={Plus} onClick={() => setOpen(true)}>
          新建项目
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title="新建项目"
        description="粘贴你的文字稿，AI 将按语义自动拆分为分镜节点。"
        className="w-[560px]"
        actions={
          <>
            <Button variant="gray" onClick={() => setOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button form="new-project-form" type="submit" icon={Sparkles} disabled={submitting}>
              生成分镜
            </Button>
          </>
        }
      >
        <form id="new-project-form" className="flex flex-col gap-4 p-4" onSubmit={handleSubmit}>
          <TextField
            label="项目名称"
            placeholder="例如：RAG 十分钟入门"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full"
          />
          <TextArea
            label="文字稿"
            placeholder={SCRIPT_PLACEHOLDER}
            value={script}
            onChange={(event) => setScript(event.target.value)}
            className="w-full"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-label">
              <AudioLines className="h-4 w-4 text-stage-audio" />
              <span>配音（可选）</span>
              <span className="text-xs text-label-tertiary">作为全片时间地基</span>
            </div>
            <Button type="button" variant="gray" size="sm" icon={Upload}>
              上传音频
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-label-tertiary">
            <Timer className="h-3 w-3" />
            预计 6–8 个分镜 · 首轮渲染约 3–5 分钟
          </p>
          {error && <Toast variant="error" title="创建失败" body={error} className="w-full" />}
        </form>
      </Dialog>
    </>
  )
}
