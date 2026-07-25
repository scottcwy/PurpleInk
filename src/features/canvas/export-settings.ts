import { z } from 'zod'

/**
 * 导出分辨率预设：全部保持 9:16 竖屏比例（与 FABRICATE 母版画幅同比例）。
 * 分辨率仅是编码/交付参数，不进入内容生产（见 issue-06 §A.5）。
 *
 * 本模块是 features/canvas 下的叶子模块（仅依赖 zod），供 canvas / render / director
 * 三方共享同一份单一事实源：render→canvas、director→canvas 均为既有合法依赖方向，
 * 放在此处可避免 director→render / render↔canvas 循环依赖（见 issue-06 §A.2 边界修正）。
 */
export const EXPORT_RESOLUTION_PRESETS = {
  '1080x1920': { width: 1080, height: 1920, label: '1080×1920 · 竖屏高清' },
  '720x1280': { width: 720, height: 1280, label: '720×1280 · 竖屏标清' },
  '540x960': { width: 540, height: 960, label: '540×960 · 竖屏流畅' },
} as const

export type ResolutionPreset = keyof typeof EXPORT_RESOLUTION_PRESETS

export interface ExportSettings {
  resolutionPreset: ResolutionPreset
}

/** 母版画幅预设：与 features/director/stage-result.ts 的 FABRICATE 画幅一致，不可经导出设置更改。 */
export const MASTER_RESOLUTION_PRESET: ResolutionPreset = '1080x1920'

export const MASTER_WIDTH = EXPORT_RESOLUTION_PRESETS[MASTER_RESOLUTION_PRESET].width
export const MASTER_HEIGHT = EXPORT_RESOLUTION_PRESETS[MASTER_RESOLUTION_PRESET].height

/** 项目从未设置导出参数时（DB 列为 null）的回退默认。 */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolutionPreset: MASTER_RESOLUTION_PRESET,
}

const RESOLUTION_PRESET_KEYS = Object.keys(EXPORT_RESOLUTION_PRESETS) as [
  ResolutionPreset,
  ...ResolutionPreset[],
]

export const exportSettingsSchema = z
  .object({
    resolutionPreset: z.enum(RESOLUTION_PRESET_KEYS),
  })
  .strict()

/** 把未知来源（DB JSON 列 / 请求体）归一化为合法 ExportSettings；非法或 null 回退默认。 */
export function resolveExportSettings(raw: unknown): ExportSettings {
  const parsed = exportSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_EXPORT_SETTINGS
}

/** 预设 → 目标物理像素尺寸。 */
export function resolutionForPreset(preset: ResolutionPreset): {
  width: number
  height: number
} {
  const { width, height } = EXPORT_RESOLUTION_PRESETS[preset]
  return { width, height }
}
