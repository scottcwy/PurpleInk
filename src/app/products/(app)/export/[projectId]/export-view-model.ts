import {
  EXPORT_RESOLUTION_PRESETS,
  type ResolutionPreset,
} from '@/features/canvas/export-settings'
import type { TimelineClipSpan } from '@/components/ui/timeline-track'

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
