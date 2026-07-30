import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
  SUBTITLE_DELIVERY_MODES,
  type ResolutionPreset,
  type SubtitleDeliveryMode,
} from '@/features/canvas/export-settings'

/**
 * 导出就绪合同的客户端形状、解析与文案。
 *
 * 与 `export-api.ts` 的分工：那边只负责 HTTP（发请求、判 401、轮询作业），
 * 这边只负责把未受信的响应体收窄成 `ExportReadiness`，以及把阻塞项翻译成
 * 人类可读文案。纯函数，可以脱离 fetch 单测。
 */

export interface ExportReadiness {
  ready: boolean
  incompleteNodeIds: string[]
  shotCount: number
  /** laneKey → QA 是否通过；null/缺失表示尚未检测（不得当作通过）。 */
  shotQa: Record<string, boolean | null>
  resolutionPreset: ResolutionPreset
  /** 当前导出设置里的字幕交付选择（下次导出会产出什么）。 */
  subtitles: SubtitleDeliveryMode
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
  /**
   * 就绪字幕数；本次交付不含字幕时为 null（服务端未测量）。
   *
   * 不能塌成 0：关着字幕时显示「字幕 0/5」会被读成「字幕一个都没好」。
   */
  subtitleReadyCount: number | null
  requiredShotCount: number
  delivery:
    | 'legacy-silent-v1'
    | 'narration-hard-subtitle-v2'
    | 'narration-no-subtitle-v3'
}

/** 把未受信响应体收窄成 ExportReadiness；结构不合法直接抛错而不是编造默认值。 */
export function parseExportReadiness(
  body: Record<string, unknown>
): ExportReadiness {
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
    subtitles: isSubtitleMode(body.subtitles)
      ? body.subtitles
      : DEFAULT_EXPORT_SETTINGS.subtitles,
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
    ...(typeof body.artifactUrl === 'string'
      ? { artifactUrl: body.artifactUrl }
      : {}),
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

function isSubtitleMode(value: unknown): value is SubtitleDeliveryMode {
  return SUBTITLE_DELIVERY_MODES.includes(value as SubtitleDeliveryMode)
}

export function toBlockingIssues(value: unknown): ExportBlockingIssue[] {
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
    subtitleReadyCount:
      raw.subtitleReadyCount === null ? null : countOf(raw.subtitleReadyCount),
    requiredShotCount: countOf(raw.requiredShotCount, fallbackCount),
    delivery: isMediaDelivery(raw.delivery)
      ? raw.delivery
      : 'narration-hard-subtitle-v2',
  }
}

function isMediaDelivery(
  value: unknown
): value is ExportMediaReadiness['delivery'] {
  return (
    value === 'legacy-silent-v1' ||
    value === 'narration-hard-subtitle-v2' ||
    value === 'narration-no-subtitle-v3'
  )
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
