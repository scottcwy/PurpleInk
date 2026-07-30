import { z } from 'zod'
import {
  PROCEDURAL_SFX_MODES,
  type ProceduralSfxMode,
} from '@purpleink/procedural-sfx'

/**
 * 导出分辨率预设：全部保持 16:9 横屏比例（与 FABRICATE 母版画幅同比例）。
 * 分辨率仅是编码/交付参数，不进入内容生产（见 issue-06 §A.5）。
 *
 * 本模块是 features/canvas 下的叶子模块（仅依赖 zod），供 canvas / render / director
 * 三方共享同一份单一事实源：render→canvas、director→canvas 均为既有合法依赖方向，
 * 放在此处可避免 director→render / render↔canvas 循环依赖（见 issue-06 §A.2 边界修正）。
 */
export const EXPORT_RESOLUTION_PRESETS = {
  '1920x1080': { width: 1920, height: 1080, label: '1920×1080 · 横屏高清' },
  '1280x720': { width: 1280, height: 720, label: '1280×720 · 横屏标清' },
  '960x540': { width: 960, height: 540, label: '960×540 · 横屏流畅' },
} as const

export type ResolutionPreset = keyof typeof EXPORT_RESOLUTION_PRESETS

/**
 * 字幕交付模式。
 *
 * `burn-in`：把字幕硬烧进画面（当前唯一的字幕交付形态）。
 * `off`：本次成片不含字幕；缺字幕产物也不再阻塞导出。
 *
 * 用可辨识字符串而不是布尔，是为了以后新增旁挂 .srt 之类的形态时不需要改字段类型。
 */
export const SUBTITLE_DELIVERY_MODES = ['burn-in', 'off'] as const

export type SubtitleDeliveryMode = (typeof SUBTITLE_DELIVERY_MODES)[number]

export interface ExportSettings {
  resolutionPreset: ResolutionPreset
  subtitles: SubtitleDeliveryMode
  soundEffects: ProceduralSfxMode
}

/** 母版画幅预设：与 features/director/stage-result.ts 的 FABRICATE 画幅一致，不可经导出设置更改。 */
export const MASTER_RESOLUTION_PRESET: ResolutionPreset = '1920x1080'

export const MASTER_WIDTH = EXPORT_RESOLUTION_PRESETS[MASTER_RESOLUTION_PRESET].width
export const MASTER_HEIGHT = EXPORT_RESOLUTION_PRESETS[MASTER_RESOLUTION_PRESET].height
export const MASTER_ASPECT_RATIO = MASTER_WIDTH / MASTER_HEIGHT

/** 项目从未设置导出参数时（DB 列为 null）的回退默认。 */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolutionPreset: MASTER_RESOLUTION_PRESET,
  subtitles: 'burn-in',
  soundEffects: 'off',
}

const RESOLUTION_PRESET_KEYS = Object.keys(EXPORT_RESOLUTION_PRESETS) as [
  ResolutionPreset,
  ...ResolutionPreset[],
]

/**
 * 已持久化设置的完整形状。
 *
 * `subtitles` 必须带 `.default()`：schema 是 `.strict()`，而 `resolveExportSettings`
 * 在解析失败时静默回退到 `DEFAULT_EXPORT_SETTINGS`。若新字段声明为必填，所有存量
 * 项目库里只存着 `{resolutionPreset}` 的行都会解析失败，用户已选的分辨率会被悄悄
 * 重置成母版预设——这是一次静默的数据回归，只能靠默认值避免。
 */
export const exportSettingsSchema = z
  .object({
    resolutionPreset: z.enum(RESOLUTION_PRESET_KEYS),
    subtitles: z.enum(SUBTITLE_DELIVERY_MODES).default('burn-in'),
    soundEffects: z.enum(PROCEDURAL_SFX_MODES).default('off'),
  })
  .strict()

/**
 * 局部更新的请求形状。
 *
 * PATCH 语义要求只改送来的字段：整体覆盖会让「只改分辨率」把字幕选择顺手抹回默认。
 * 空对象拒绝，避免一次什么都不改的写库。
 */
export const exportSettingsPatchSchema = z
  .object({
    resolutionPreset: z.enum(RESOLUTION_PRESET_KEYS).optional(),
    subtitles: z.enum(SUBTITLE_DELIVERY_MODES).optional(),
    soundEffects: z.enum(PROCEDURAL_SFX_MODES).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: '导出设置补丁至少需要一个字段',
  })

export type ExportSettingsPatch = z.infer<typeof exportSettingsPatchSchema>

/** 把未知来源（DB JSON 列 / 请求体）归一化为合法 ExportSettings；非法或 null 回退默认。 */
export function resolveExportSettings(raw: unknown): ExportSettings {
  const parsed = exportSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_EXPORT_SETTINGS
}

/** 把补丁并入已有设置；未出现的字段保持原值。 */
export function mergeExportSettings(
  current: ExportSettings,
  patch: ExportSettingsPatch
): ExportSettings {
  return { ...current, ...patch }
}

/** 预设 → 目标物理像素尺寸。 */
export function resolutionForPreset(preset: ResolutionPreset): {
  width: number
  height: number
} {
  const { width, height } = EXPORT_RESOLUTION_PRESETS[preset]
  return { width, height }
}
