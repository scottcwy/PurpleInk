import {
  type ExportSettingsPatch,
  type ExportSettings,
  type ResolutionPreset,
  type SubtitleDeliveryMode,
} from '@/features/canvas/export-settings'
import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'
import {
  parseExportReadiness,
  toBlockingIssues,
  blockingIssueLabel,
  type ExportReadiness,
} from './export-readiness-contract'

/**
 * 导出页的 HTTP 边界。
 *
 * 只做传输层的事：发请求、把 401 映射成可识别错误、轮询作业终态。响应体的
 * 结构收窄与文案在 `export-readiness-contract.ts`。
 */

export async function loadExportReadiness(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<ExportReadiness> {
  const response = await fetcher(
    `/api/render/export?projectId=${encodeURIComponent(projectId)}`
  )
  // 401 统一映射成可识别错误类型，由 useRequireLogin 接管（PLAN-002 §4.4）。
  throwIfUnauthenticated(response)
  const body = await objectBody(response)
  if (!response.ok) throw new Error(errorOf(body, '导出状态读取失败'))
  return parseExportReadiness(body)
}

/**
 * 入队一次成片导出并等到终态。
 *
 * 导出是项目级队列作业（final-mp4 的产物提交需要 project 级 attempt，且 ffmpeg
 * 拼接不应占用请求线程），因此接口返回 jobId；等待逻辑收在这里，调用方仍然只拿到
 * 最终的 artifactUrl，与单镜渲染的 `renderShotAndWait` 同一形状。
 */
export async function startProjectExport(
  projectId: string,
  fetcher: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = delay,
  options: {
    degraded?: boolean
    confirmationFingerprint?: string
  } = {}
): Promise<string> {
  if (options.degraded && !options.confirmationFingerprint) {
    throw new Error('降级确认已失效，请刷新导出状态后重试')
  }
  const response = await fetcher('/api/render/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      ...(options.degraded ? { degraded: true } : {}),
      ...(options.confirmationFingerprint
        ? { confirmationFingerprint: options.confirmationFingerprint }
        : {}),
    }),
  })
  throwIfUnauthenticated(response)
  const body = await objectBody(response)
  if (!response.ok) throw new Error(exportStartError(body))
  if (typeof body.jobId !== 'string') throw new Error('导出响应缺少 jobId')
  return waitForExportArtifact(projectId, body.jobId, fetcher, wait)
}

/**
 * 导出等待的墙钟上限。
 *
 * 没有上限的轮询会让 UI 永远停在「处理中」，那条进度骨架屏就变成了永久
 * Skeleton；而作业侧真正的失败可能永远不写回终态（例如进程被杀）。超时后
 * 报可读错误，用户可以刷新看真实作业状态。
 */
const EXPORT_WAIT_TIMEOUT_MS = 30 * 60 * 1_000
const EXPORT_POLL_INTERVAL_MS = 1_000

export async function waitForExportArtifact(
  projectId: string,
  jobId: string,
  fetcher: typeof fetch,
  wait: (milliseconds: number) => Promise<void>,
  now: () => number = Date.now
): Promise<string> {
  const deadline = now() + EXPORT_WAIT_TIMEOUT_MS
  for (;;) {
    const response = await fetcher(
      `/api/jobs/${encodeURIComponent(jobId)}?projectId=${encodeURIComponent(projectId)}`
    )
    throwIfUnauthenticated(response)
    const body = await objectBody(response)
    if (!response.ok) throw new Error(errorOf(body, '导出作业状态读取失败'))
    const job = body.job
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new Error('导出作业状态响应无效')
    }
    const { status, error } = job as Record<string, unknown>
    if (status === 'failed') {
      throw new Error(typeof error === 'string' ? error : '终片导出失败')
    }
    if (status === 'done') {
      if (typeof body.artifactUrl !== 'string') {
        throw new Error('导出作业已完成但缺少产物')
      }
      return body.artifactUrl
    }
    if (now() >= deadline) {
      throw new Error('导出等待超时，请刷新导出状态查看作业进展')
    }
    await wait(EXPORT_POLL_INTERVAL_MS)
  }
}

/** 未就绪时后端返回 incompleteNodeIds，转成可读文案而不是笼统失败。 */
function exportStartError(body: Record<string, unknown>): string {
  const incomplete = body.incompleteNodeIds
  if (Array.isArray(incomplete) && incomplete.length > 0) {
    return `还有 ${incomplete.length} 个节点未产出可用分镜，无法导出成片`
  }
  const issue = toBlockingIssues(body.blockingIssues)[0]
  if (issue) return blockingIssueLabel(issue)
  return errorOf(body, '终片导出失败')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function objectBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('导出响应无效')
  }
  return body as Record<string, unknown>
}

function errorOf(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback
}

/** 更新项目导出分辨率预设（PATCH /api/projects/[id]）。 */
export async function updateExportResolution(
  projectId: string,
  resolutionPreset: ResolutionPreset,
  fetcher: typeof fetch = fetch
): Promise<void> {
  return updateExportSettings(projectId, { resolutionPreset }, fetcher)
}

/** 更新项目字幕交付选择；服务端按局部补丁合并，不覆盖分辨率。 */
export async function updateExportSubtitles(
  projectId: string,
  subtitles: SubtitleDeliveryMode,
  fetcher: typeof fetch = fetch
): Promise<void> {
  return updateExportSettings(projectId, { subtitles }, fetcher)
}

/** 更新项目代码音效选择；只影响下一次导出，不伪装成最近成片事实。 */
export async function updateExportSoundEffects(
  projectId: string,
  soundEffects: ExportSettings['soundEffects'],
  fetcher: typeof fetch = fetch
): Promise<void> {
  return updateExportSettings(projectId, { soundEffects }, fetcher)
}

async function updateExportSettings(
  projectId: string,
  exportSettings: ExportSettingsPatch,
  fetcher: typeof fetch
): Promise<void> {
  const response = await fetcher(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ exportSettings }),
  })
  throwIfUnauthenticated(response)
  if (!response.ok) {
    const body = await objectBody(response).catch(() => ({}))
    throw new Error(errorOf(body, '导出设置更新失败'))
  }
}
