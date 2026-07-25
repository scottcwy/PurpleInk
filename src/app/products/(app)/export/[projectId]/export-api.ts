import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'

export interface ExportReadiness {
  ready: boolean
  incompleteNodeIds: string[]
  shotCount: number
  /** laneKey → QA 是否通过；null/缺失表示尚未检测（不得当作通过）。 */
  shotQa: Record<string, boolean | null>
  resolutionPreset: ResolutionPreset
  artifactUrl?: string
}

export async function loadExportReadiness(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<ExportReadiness> {
  const response = await fetcher(
    `/api/render/export?projectId=${encodeURIComponent(projectId)}`
  )
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
    ...(typeof body.artifactUrl === 'string' ? { artifactUrl: body.artifactUrl } : {}),
  }
}

export async function startProjectExport(
  projectId: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const response = await fetcher('/api/render/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  const body = await objectBody(response)
  if (!response.ok) throw new Error(errorOf(body, '终片导出失败'))
  if (typeof body.artifactUrl !== 'string') throw new Error('导出响应缺少 artifactUrl')
  return body.artifactUrl
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
