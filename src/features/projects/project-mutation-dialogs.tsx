'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextField } from '@/components/ui/text-field'
import { Toast } from '@/components/ui/toast'
import {
  deleteProjectRequest,
  renameProjectRequest,
  validateProjectTitle,
} from './project-mutation-client'

export interface ProjectDialogTarget {
  id: string
  title: string
}

/** 401 归一化处理由唯一的登录门（project-context-menu）接管，返回 true 表示已接管。 */
export type AuthErrorHandler = (error: unknown) => boolean

/** 重命名弹窗：非法标题在提交前拦下，不发请求。 */
export function ProjectRenameDialog({
  project,
  onClose,
  onRenamed,
  onAuthError,
}: {
  project: ProjectDialogTarget
  onClose: () => void
  onRenamed: (projectId: string, title: string) => void
  onAuthError: AuthErrorHandler
}) {
  const [title, setTitle] = useState(project.title)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(): Promise<void> {
    const invalid = validateProjectTitle(title)
    if (invalid) {
      setError(invalid)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const persisted = await renameProjectRequest(project.id, title.trim())
      onRenamed(project.id, persisted)
      onClose()
    } catch (cause) {
      if (onAuthError(cause)) return
      setError(cause instanceof Error ? cause.message : '项目重命名失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      placement="center"
      title="重命名项目"
      description="只改项目标题，不影响已生成的节点与产物。"
      className="w-[440px]"
      actions={
        <>
          <Button variant="gray" disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <TextField
        label="项目标题"
        value={title}
        autoFocus
        maxLength={200}
        className="w-full"
        onChange={(event) => {
          setTitle(event.target.value)
          setError(null)
        }}
      />
      {error && <Toast variant="error" title="无法重命名" body={error} className="w-full" />}
    </Dialog>
  )
}

/** 删除二次确认：文案必须写明不可恢复与连带范围。 */
export function ProjectDeleteDialog({
  project,
  onClose,
  onDeleted,
  onAuthError,
}: {
  project: ProjectDialogTarget
  onClose: () => void
  onDeleted: (projectId: string) => void
  onAuthError: AuthErrorHandler
}) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      await deleteProjectRequest(project.id)
      onDeleted(project.id)
      onClose()
    } catch (cause) {
      if (onAuthError(cause)) return
      setError(cause instanceof Error ? cause.message : '项目删除失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      placement="center"
      title="删除项目"
      description={`「${project.title}」及其全部节点、执行记录与产物将从数据库中永久删除，无法恢复。其他项目不受影响。`}
      className="w-[440px]"
      actions={
        <>
          <Button variant="gray" disabled={submitting} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? '删除中…' : '永久删除'}
          </Button>
        </>
      }
    >
      {error && <Toast variant="error" title="无法删除" body={error} className="w-full" />}
    </Dialog>
  )
}

