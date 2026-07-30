import type {
  ProjectExecutionSnapshot,
  WebsiteDeliverySnapshot,
} from '@/features/projects'

export interface WebsiteExportAction {
  mode: 'start' | 'stop' | 'busy' | 'download'
  label: string
}

export function websiteExportAction(
  execution: ProjectExecutionSnapshot,
): WebsiteExportAction {
  if (execution.state === 'succeeded') {
    return { mode: 'download', label: '下载 MP4' }
  }
  if (execution.state === 'stopping') {
    return { mode: 'busy', label: '正在安全停止' }
  }
  if (
    execution.state === 'queued'
    || execution.state === 'running'
    || execution.state === 'recovering'
  ) {
    return { mode: 'stop', label: '停止项目' }
  }
  if (execution.state === 'blocked') {
    return { mode: 'start', label: '重新生成' }
  }
  if (execution.state === 'failed' || execution.state === 'cancelled') {
    return { mode: 'start', label: '重新启动' }
  }
  return { mode: 'start', label: '一键启动' }
}

export function websiteDeliveryForDownload(
  execution: ProjectExecutionSnapshot,
): WebsiteDeliverySnapshot | null {
  const delivery = execution.delivery
  const verification = delivery?.verification
  if (
    execution.state !== 'succeeded'
    || execution.attempt?.status !== 'succeeded'
    || !delivery
    || delivery.attemptId !== execution.attempt.id
    || delivery.lifecycle !== 'approved'
    || !delivery.downloadUrl
    || verification?.outcome !== 'passed'
    || verification.checkPassed !== true
    || verification.goldenVerified !== true
  ) {
    return null
  }
  return delivery
}

export function websiteDownloadHref(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=1`
}

export function websiteExportProgress(
  execution: ProjectExecutionSnapshot,
): { completed: number; total: number; label: string } {
  const total = 6
  const completed = execution.stages.filter(
    (stage) => stage.state === 'succeeded',
  ).length
  return { completed, total, label: `已完成 ${completed}/${total} 阶段` }
}
