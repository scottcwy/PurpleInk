import type {
  CreateProjectInput,
  ProjectVisualTheme,
} from '@/features/projects/project-create-client'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'

export interface NewProjectFormValues {
  kind: ProjectWorkflowKind
  title: string
  script: string
  audioFile?: File
  websiteUrl: string
  visualTheme: ProjectVisualTheme
}

export function validateNewProjectInput(
  values: NewProjectFormValues,
): string | undefined {
  if (!values.title.trim()) return '项目名称不能为空'
  if (values.kind === 'script' && !values.script.trim()) return '请粘贴文字稿'
  if (values.kind === 'audio') {
    if (!values.audioFile) return '请选择 MP3 或 WAV 录音文件'
    if (values.audioFile.size <= 0) return '录音文件不能为空'
    if (values.audioFile.size > 100 * 1024 * 1024) {
      return '录音文件不能超过 100 MB'
    }
  }
  if (values.kind === 'website' && !isPublicHttpUrl(values.websiteUrl)) {
    return '请输入以 http(s):// 开头的公开网站 URL'
  }
  return undefined
}

export function buildNewProjectInput(
  values: NewProjectFormValues,
): CreateProjectInput {
  if (values.kind === 'script') {
    return {
      kind: 'script',
      title: values.title,
      script: values.script,
      visualTheme: values.visualTheme,
    }
  }
  if (values.kind === 'audio') {
    if (!values.audioFile) throw new Error('请选择 MP3 或 WAV 录音文件')
    return {
      kind: 'audio',
      title: values.title,
      file: values.audioFile,
      visualTheme: values.visualTheme,
    }
  }
  return {
    kind: 'website',
    title: values.title,
    url: values.websiteUrl,
    durationSec: 24,
    quality: 'standard',
    visualTheme: values.visualTheme,
  }
}

export function isProjectKind(value: string): value is ProjectWorkflowKind {
  return value === 'script' || value === 'audio' || value === 'website'
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
