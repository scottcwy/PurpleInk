import {
  EXPORT_RESOLUTION_PRESETS,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'
import type { TimelineClipSpan } from '@/components/ui/timeline-track'
import {
  blockingIssueLabel,
  type ExportReadiness,
} from './export-readiness-contract'

const RESOLUTION_TIER_LABEL: Record<ResolutionPreset, string> = {
  '1920x1080': '高清',
  '1280x720': '标清',
  '960x540': '流畅',
}

export function buildResolutionOptions() {
  return Object.keys(EXPORT_RESOLUTION_PRESETS).map((value) => ({
    value,
    label: RESOLUTION_TIER_LABEL[value as ResolutionPreset],
  }))
}

/**
 * 把分镜通道摆到轨道上，位置按它在**全部通道**里的次序。
 *
 * `present` 用来表达「这条轨道上只有部分通道有产物」。关键是缺失的通道要留出
 * 空位，而不是让后面的 clip 前移：S001 与 S003 就绪、S002 缺失时，S003 必须画在
 * 第三格。否则轨道会暗示错误的时间位置，且与分镜轨对不齐。
 *
 * 宽度目前按通道数均分。真实时长（`ExportReadiness.timeline`）的接线随导出页
 * 布局重做一起落地。
 */
export function buildLaneSpans(
  allLaneKeys: readonly string[],
  present: readonly string[] = allLaneKeys
): TimelineClipSpan[] {
  const ordered = [...allLaneKeys].sort((left, right) => left.localeCompare(right))
  if (ordered.length === 0) return []
  const slot = 1 / ordered.length
  const visible = new Set(present)
  return ordered.flatMap((laneKey, index) =>
    visible.has(laneKey)
      ? [{ start: index * slot, width: slot, label: laneKey }]
      : []
  )
}

export type ExportDeliveryState = 'ready' | 'degraded' | 'needs-attention'
export type ExportDeliveryMetricKey = 'render' | 'narration' | 'subtitle' | 'qa'
export type ExportDeliveryMetricState = 'ready' | 'warning' | 'pending'
export type ExportDeliveryIssueTone = 'blocked' | 'warning' | 'pending'

export interface ExportDeliveryMetric {
  key: ExportDeliveryMetricKey
  label: string
  value: string
  detail: string
  state: ExportDeliveryMetricState
}

export interface ExportDeliveryIssue {
  key: string
  label: string
  tone: ExportDeliveryIssueTone
}

export interface ExportDeliveryCheckModel {
  state: ExportDeliveryState
  statusLabel: string
  description: string
  metrics: ExportDeliveryMetric[]
  issues: ExportDeliveryIssue[]
  incompleteNodeCount: number
}

interface QaSummary {
  total: number
  passed: number
  failed: number
  pending: number
  waived: number
}

/**
 * 把导出 readiness 收敛成用户可读的交付检查。
 *
 * 不展示原始 node id，也不把 QA 豁免算成成功；该投影只消费已有 API 真值，
 * 不触发工作流、缩略图生成或任何写入。
 */
export function buildExportDeliveryCheck(
  laneKeys: readonly string[],
  readiness: ExportReadiness,
): ExportDeliveryCheckModel {
  const lanes = [...new Set(laneKeys)].sort((left, right) =>
    left.localeCompare(right),
  )
  const waived = new Set(readiness.waivedQaLanes)
  const qa = summarizeQa(lanes, waived, readiness.shotQa)
  const state = deliveryState(readiness, qa.passed !== qa.total)

  return {
    state,
    statusLabel: deliveryStatusLabel(state),
    description: deliveryDescription(state),
    metrics: deliveryMetrics(lanes.length, readiness, qa),
    issues: deliveryIssues(lanes, waived, readiness),
    incompleteNodeCount: readiness.incompleteNodeIds.length,
  }
}

function deliveryState(
  readiness: ExportReadiness,
  hasUnacceptedQa: boolean,
): ExportDeliveryState {
  if (readiness.ready && !hasUnacceptedQa) return 'ready'
  return readiness.degradedReady ? 'degraded' : 'needs-attention'
}

function deliveryStatusLabel(state: ExportDeliveryState): string {
  if (state === 'ready') return '可完整导出'
  if (state === 'degraded') return '可降级交付'
  return '尚未具备导出条件'
}

function deliveryDescription(state: ExportDeliveryState): string {
  if (state === 'ready') return '镜头、媒体与验收门禁均已满足。'
  if (state === 'degraded') return '存在占位或未验收镜头，需要人工确认后才能降级交付。'
  return '仍有工作流节点或媒体产物需要处理。'
}

function deliveryMetrics(
  laneCount: number,
  readiness: ExportReadiness,
  qa: QaSummary,
): ExportDeliveryMetric[] {
  const subtitle: ExportDeliveryMetric =
    readiness.subtitles === 'off'
      ? {
          key: 'subtitle',
          label: '字幕',
          value: '本次不入片',
          detail: '导出设置已关闭字幕交付',
          state: 'ready',
        }
      : mediaMetric({
          key: 'subtitle',
          label: '字幕',
          ready: readiness.media.subtitleReadyCount ?? 0,
          required: readiness.media.requiredShotCount,
        })
  return [
    countMetric({
      key: 'render',
      label: '镜头画面',
      ready: readiness.shotCount,
      required: laneCount,
      detail: '已登记可用渲染产物',
    }),
    mediaMetric({
      key: 'narration',
      label: '旁白',
      ready: readiness.media.narrationReadyCount,
      required: readiness.media.requiredShotCount,
    }),
    subtitle,
    {
      key: 'qa',
      label: '镜头验收',
      value: qa.total === 0 ? '暂无分镜' : `${qa.passed}/${qa.total}`,
      detail: qaDetail(qa),
      state: qaMetricState(qa),
    },
  ]
}

function countMetric(input: {
  key: ExportDeliveryMetricKey
  label: string
  ready: number
  required: number
  detail: string
}): ExportDeliveryMetric {
  return {
    key: input.key,
    label: input.label,
    value: input.required === 0 ? '暂无分镜' : `${input.ready}/${input.required}`,
    detail: input.detail,
    state: countMetricState(input.ready, input.required),
  }
}

function mediaMetric(input: {
  key: 'narration' | 'subtitle'
  label: string
  ready: number
  required: number
}): ExportDeliveryMetric {
  if (input.required === 0) {
    return {
      key: input.key,
      label: input.label,
      value: '尚未建立',
      detail: '媒体时间合同尚未就绪',
      state: 'pending',
    }
  }
  return countMetric({
    ...input,
    detail: '已登记可用于成片装配的媒体',
  })
}

function countMetricState(ready: number, required: number): ExportDeliveryMetricState {
  if (required > 0 && ready >= required) return 'ready'
  return ready > 0 ? 'warning' : 'pending'
}

function qaMetricState(input: QaSummary): ExportDeliveryMetricState {
  if (input.total > 0 && input.passed === input.total) return 'ready'
  if (input.failed > 0 || input.waived > 0) return 'warning'
  return 'pending'
}

function qaDetail(input: QaSummary): string {
  if (input.total === 0) return '暂无可验收镜头'
  const parts = [
    input.failed > 0 ? `${input.failed} 镜未通过` : '',
    input.pending > 0 ? `${input.pending} 镜待验收` : '',
    input.waived > 0 ? `${input.waived} 镜未验收` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '全部镜头已通过验收'
}

function deliveryIssues(
  lanes: readonly string[],
  waived: ReadonlySet<string>,
  readiness: ExportReadiness,
): ExportDeliveryIssue[] {
  const issues: ExportDeliveryIssue[] = readiness.blockingIssues
    .map((issue) => ({
      key: `blocking:${issue.laneKey ?? 'project'}:${issue.kind}:${issue.code}`,
      label: blockingIssueLabel(issue),
      tone: issue.code === 'node-incomplete' ? 'pending' as const : 'blocked' as const,
    }))
    .sort((left, right) => left.key.localeCompare(right.key))

  for (const laneKey of lanes) {
    if (waived.has(laneKey)) {
      issues.push({
        key: `qa:${laneKey}`,
        label: `${laneKey} · 已豁免，仍属未验收`,
        tone: 'warning',
      })
    } else if (readiness.shotQa[laneKey] === false) {
      issues.push({
        key: `qa:${laneKey}`,
        label: `${laneKey} · 镜头验收未通过`,
        tone: 'blocked',
      })
    } else if (readiness.shotQa[laneKey] !== true) {
      issues.push({
        key: `qa:${laneKey}`,
        label: `${laneKey} · 等待镜头验收`,
        tone: 'pending',
      })
    }
  }
  return issues
}

function summarizeQa(
  lanes: readonly string[],
  waived: ReadonlySet<string>,
  shotQa: ExportReadiness['shotQa'],
): QaSummary {
  const summary: QaSummary = {
    total: lanes.length,
    passed: 0,
    failed: 0,
    pending: 0,
    waived: 0,
  }
  for (const laneKey of lanes) {
    if (waived.has(laneKey)) summary.waived += 1
    else if (shotQa[laneKey] === true) summary.passed += 1
    else if (shotQa[laneKey] === false) summary.failed += 1
    else summary.pending += 1
  }
  return summary
}
