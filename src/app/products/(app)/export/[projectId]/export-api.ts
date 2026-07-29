import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'
import { throwIfUnauthenticated } from '@/features/auth/unauthenticated-error'

export interface ExportReadiness {
  ready: boolean
  incompleteNodeIds: string[]
  shotCount: number
  /** laneKey → QA 是否通过；null/缺失表示尚未检测（不得当作通过）。 */
  shotQa: Record<string, boolean | null>
  resolutionPreset: ResolutionPreset
  artifactUrl?: string
  blockingIssues: ExportBlockingIssue[]
  media: ExportMediaReadiness
  /** 当前缺渲染产物、可占位出片的 lane。 */
  placeholderCandidateLanes: string[]
  /** 已人工豁免 QA、仍属于未验收的 lane。 */
  waivedQaLanes: string[]
  /** 降级导出是否可行（无项目级完整性阻塞）。 */
  degradedReady: boolean
  confirmationFingerprint: string | null
  /** 最新成片若为降级产物，列出其占位镜头。 */
  degradedExport: { placeholderLanes: string[]; waivedQaLanes: string[] } | null
  artifactDelivery:
    | 'none'
    | 'legacy-silent-v1'
    | 'narration-hard-subtitle-v2'
}

export interface ExportBlockingIssue {
  laneKey: string | null
  kind: 'render' | 'narration' | 'subtitle'
  code: 'node-incomplete' | 'artifact-missing' | 'artifact-invalid'
}

export interface ExportMediaReadiness {
  narrationReadyCount: number
  subtitleReadyCount: number
  requiredShotCount: number
  delivery: 'legacy-silent-v1' | 'narration-hard-subtitle-v2'
}

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
  if (
    typeof body.ready !== 'boolean' ||
    !Array.isArray(body.incompleteNodeIds) ||
    !body.incompleteNodeIds.every((value) => typeof value === 'string') ||
    typeof body.shotCount !== 'number'
  ) {
    throw new Error('导出状态响应无效')
  }
  return {
    ready: body.ready,
    incompleteNodeIds: body.incompleteNodeIds as string[],
    shotCount: body.shotCount,
    shotQa: toShotQa(body.shotQa),
    resolutionPreset: isResolutionPreset(body.resolutionPreset)
      ? body.resolutionPreset
      : DEFAULT_EXPORT_SETTINGS.resolutionPreset,
    blockingIssues: toBlockingIssues(body.blockingIssues),
    media: toMediaReadiness(body.media, body.shotCount),
    placeholderCandidateLanes: toStringArray(body.placeholderCandidateLanes),
    waivedQaLanes: toStringArray(body.waivedQaLanes),
    degradedReady: body.degradedReady === true,
    confirmationFingerprint:
      typeof body.confirmationFingerprint === 'string'
        ? body.confirmationFingerprint
        : null,
    degradedExport: toDegradedExport(body.degradedExport),
    artifactDelivery: isArtifactDelivery(body.artifactDelivery)
      ? body.artifactDelivery
      : 'none',
    ...(typeof body.artifactUrl === 'string' ? { artifactUrl: body.artifactUrl } : {}),
  }
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

async function waitForExportArtifact(
  projectId: string,
  jobId: string,
  fetcher: typeof fetch,
  wait: (milliseconds: number) => Promise<void>
): Promise<string> {
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
    await wait(1000)
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
  const response = await fetcher(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ exportSettings: { resolutionPreset } }),
  })
  throwIfUnauthenticated(response)
  if (!response.ok) {
    const body = await objectBody(response).catch(() => ({}))
    throw new Error(errorOf(body, '导出设置更新失败'))
  }
}

function toShotQa(value: unknown): Record<string, boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, boolean | null> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = typeof raw === 'boolean' ? raw : null
  }
  return result
}

function isResolutionPreset(value: unknown): value is ResolutionPreset {
  return typeof value === 'string' && value in EXPORT_RESOLUTION_PRESETS
}

function toBlockingIssues(value: unknown): ExportBlockingIssue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const raw = item as Record<string, unknown>
    const laneKey =
      raw.laneKey === null || typeof raw.laneKey === 'string'
        ? raw.laneKey
        : undefined
    if (
      laneKey === undefined ||
      !['render', 'narration', 'subtitle'].includes(String(raw.kind)) ||
      !['node-incomplete', 'artifact-missing', 'artifact-invalid'].includes(
        String(raw.code)
      )
    ) {
      return []
    }
    return [
      {
        laneKey,
        kind: raw.kind as ExportBlockingIssue['kind'],
        code: raw.code as ExportBlockingIssue['code'],
      },
    ]
  })
}

function toMediaReadiness(
  value: unknown,
  shotCount: unknown
): ExportMediaReadiness {
  const fallbackCount = typeof shotCount === 'number' ? shotCount : 0
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      narrationReadyCount: 0,
      subtitleReadyCount: 0,
      requiredShotCount: fallbackCount,
      delivery: 'narration-hard-subtitle-v2',
    }
  }
  const raw = value as Record<string, unknown>
  return {
    narrationReadyCount: countOf(raw.narrationReadyCount),
    subtitleReadyCount: countOf(raw.subtitleReadyCount),
    requiredShotCount: countOf(raw.requiredShotCount, fallbackCount),
    delivery:
      raw.delivery === 'legacy-silent-v1'
        ? 'legacy-silent-v1'
        : 'narration-hard-subtitle-v2',
  }
}

function countOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback
}

function isArtifactDelivery(
  value: unknown
): value is ExportReadiness['artifactDelivery'] {
  return (
    value === 'none' ||
    value === 'legacy-silent-v1' ||
    value === 'narration-hard-subtitle-v2'
  )
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toDegradedExport(
  value: unknown
): { placeholderLanes: string[]; waivedQaLanes: string[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  return {
    placeholderLanes: toStringArray(raw.placeholderLanes),
    waivedQaLanes: toStringArray(raw.waivedQaLanes),
  }
}

export function blockingIssueLabel(issue: ExportBlockingIssue): string {
  const target = issue.laneKey ?? '项目'
  if (issue.code === 'artifact-invalid') return `${target} 产物无效`
  if (issue.code === 'node-incomplete') return `${target} 节点未完成`
  if (issue.kind === 'narration') return `${target} 缺旁白`
  if (issue.kind === 'subtitle') return `${target} 缺字幕`
  return `${target} 缺渲染产物`
}
