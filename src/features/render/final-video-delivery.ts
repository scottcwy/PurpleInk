import type { SubtitleDeliveryMode } from '@/features/canvas/export-settings'

/**
 * 成片交付形态与 artifact schemaVersion 的唯一映射。
 *
 * 为什么必须把形态写进产物、而不是导出时读一次设置就算完：设置可以在导出之后
 * 被改。若 UI 用「当前设置」描述「已存在的成片」，用户一关字幕开关，页面就会
 * 宣称那份烧了字幕的 mp4 不含字幕——正是 AGENTS.md §6 禁止的不可追溯字段。
 *
 * 这一族 schemaVersion 的版本号历来就在区分交付形态而不只是结构版本
 * （v1 静音、v2 旁白+硬字幕），v3 延续同一读法：旁白、不烧字幕。
 */
export type FinalVideoDelivery =
  | 'legacy-silent-v1'
  | 'narration-hard-subtitle-v2'
  | 'narration-no-subtitle-v3'

const SCHEMA_VERSION_BY_DELIVERY = {
  'narration-hard-subtitle-v2': 'cvc.final-video/v2',
  'narration-no-subtitle-v3': 'cvc.final-video/v3',
} as const satisfies Partial<Record<FinalVideoDelivery, string>>

/** 本次导出设置对应的交付形态。 */
export function deliveryForSubtitles(
  subtitles: SubtitleDeliveryMode
): Exclude<FinalVideoDelivery, 'legacy-silent-v1'> {
  return subtitles === 'burn-in'
    ? 'narration-hard-subtitle-v2'
    : 'narration-no-subtitle-v3'
}

/** 登记成片产物时写入的 schemaVersion。 */
export function finalVideoSchemaVersion(
  subtitles: SubtitleDeliveryMode
): string {
  return SCHEMA_VERSION_BY_DELIVERY[deliveryForSubtitles(subtitles)]
}

/** 已存在成片的交付形态：未知或更早的版本一律视为旧版静音成片。 */
export function deliveryFromSchemaVersion(
  schemaVersion: string
): FinalVideoDelivery {
  for (const [delivery, version] of Object.entries(
    SCHEMA_VERSION_BY_DELIVERY
  )) {
    if (version === schemaVersion) return delivery as FinalVideoDelivery
  }
  return 'legacy-silent-v1'
}

/** 用户可见的交付文案；状态不只靠颜色表达，这里给的是唯一文本口径。 */
export function finalVideoDeliveryLabel(delivery: FinalVideoDelivery): string {
  if (delivery === 'narration-hard-subtitle-v2') return '旁白 + 硬字幕烧录'
  if (delivery === 'narration-no-subtitle-v3') return '旁白 · 无字幕'
  return '旧版静音成片'
}
