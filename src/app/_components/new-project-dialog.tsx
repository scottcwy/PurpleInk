'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AudioLines, Plus, Sparkles, Timer, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextArea } from '@/components/ui/text-area'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import { productCanvasHref } from '@/features/navigation/products-routes'
import { createProjectAndStartIngest } from './new-project-api'

const SCRIPT_PLACEHOLDER =
  '你有没有想过，为什么大语言模型总是一本正经地胡说八道？这背后不是它"想骗人"，而是它的训练目标决定的——它只学会了"下一个词最可能是什么"。今天这支视频，我们用十分钟讲清楚 RAG：给模型配一本可以翻阅的参考书……'

const VISUAL_THEME_OPTIONS = [
  { value: 'dark', label: '深色系' },
  { value: 'light', label: '浅色系' },
] as const

export interface NewProjectDialogProps {
  featured?: boolean
}

export function NewProjectDialog({ featured = false }: NewProjectDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [script, setScript] = useState('')
  const [visualTheme, setVisualTheme] = useState<'dark' | 'light'>('dark')
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
      const { projectId } = await createProjectAndStartIngest({
        title,
        script,
        visualTheme,
      })
      router.push(productCanvasHref(projectId))
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
          className="h-24 w-full flex-col gap-2 rounded-lg"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-7 text-ds-blue" />
          <span className="text-[17px] text-ds-text">粘贴一段文字稿，开始创作</span>
          <span className="text-xs font-normal text-ds-text-muted">
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
        title="创建项目"
        description="规划开始前，源文本会先保存为版本化项目 Snapshot。"
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
        <form id="new-project-form" className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <TextField
            label="项目名称"
            placeholder="例如：RAG 十分钟入门"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ds-text">视频色调</span>
            <SegmentedControl
              options={[...VISUAL_THEME_OPTIONS]}
              value={visualTheme}
              onChange={(value) => {
                if (value === 'dark' || value === 'light') setVisualTheme(value)
              }}
              className="w-full justify-stretch [&>button]:flex-1"
            />
          </div>
          <TextArea
            label="源文本"
            placeholder={SCRIPT_PLACEHOLDER}
            value={script}
            onChange={(event) => setScript(event.target.value)}
            className="w-full [&>textarea]:min-h-[220px]"
          />
          <div className="rounded-md bg-ds-surface-muted p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] text-ds-text">
                <AudioLines className="size-4 text-ds-blue" />
              <span>配音（可选）</span>
                <span className="text-xs text-ds-text-muted">作为全片时间地基</span>
              </div>
              <Button
                type="button"
                variant="gray"
                size="sm"
                icon={Upload}
                disabled
                title="音频上传尚未接线"
              >
                上传音频
              </Button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ds-text-muted">
              <Timer className="size-3" />
              预计规划：6–8 个镜头 · ProjectSourceSnapshotV1
            </p>
          </div>
          {error && <Toast variant="error" title="创建失败" body={error} className="w-full" />}
        </form>
      </Dialog>
    </>
  )
}
