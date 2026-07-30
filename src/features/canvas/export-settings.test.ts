import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
  MASTER_HEIGHT,
  MASTER_ASPECT_RATIO,
  MASTER_RESOLUTION_PRESET,
  MASTER_WIDTH,
  SUBTITLE_DELIVERY_MODES,
  exportSettingsPatchSchema,
  exportSettingsSchema,
  mergeExportSettings,
  resolutionForPreset,
  resolveExportSettings,
  type ResolutionPreset,
} from './export-settings'

describe('export-settings presets', () => {
  it('keeps every preset at a 16:9 landscape ratio', () => {
    for (const preset of Object.values(EXPORT_RESOLUTION_PRESETS)) {
      expect(preset.width / preset.height).toBeCloseTo(16 / 9, 5)
    }
  })

  it('anchors the master preset at 1920×1080', () => {
    expect(MASTER_RESOLUTION_PRESET).toBe('1920x1080')
    expect(MASTER_WIDTH).toBe(1920)
    expect(MASTER_HEIGHT).toBe(1080)
    expect(MASTER_ASPECT_RATIO).toBeCloseTo(16 / 9, 5)
    expect(EXPORT_RESOLUTION_PRESETS[MASTER_RESOLUTION_PRESET]).toMatchObject({
      width: 1920,
      height: 1080,
    })
    expect(DEFAULT_EXPORT_SETTINGS).toEqual({
      resolutionPreset: '1920x1080',
      subtitles: 'burn-in',
      soundEffects: 'off',
    })
  })

  it('maps a preset key to its physical resolution', () => {
    expect(resolutionForPreset('960x540')).toEqual({ width: 960, height: 540 })
  })
})

describe('resolveExportSettings', () => {
  it('passes through a valid preset', () => {
    expect(resolveExportSettings({ resolutionPreset: '1280x720' })).toEqual({
      resolutionPreset: '1280x720',
      subtitles: 'burn-in',
      soundEffects: 'off',
    })
  })

  it('keeps a stored row that predates the subtitles field intact', () => {
    // 存量项目库里存的是 {resolutionPreset}。schema 是 strict 且解析失败会静默
    // 回退到默认，所以新字段必须有默认值——否则所有人已选的分辨率会被悄悄重置。
    expect(resolveExportSettings({ resolutionPreset: '960x540' })).toEqual({
      resolutionPreset: '960x540',
      subtitles: 'burn-in',
      soundEffects: 'off',
    })
  })

  it('reads a persisted subtitles choice back', () => {
    expect(
      resolveExportSettings({ resolutionPreset: '1280x720', subtitles: 'off' })
    ).toEqual({
      resolutionPreset: '1280x720',
      subtitles: 'off',
      soundEffects: 'off',
    })
  })

  it('reads a persisted procedural sound-effects choice back', () => {
    expect(
      resolveExportSettings({
        resolutionPreset: '1280x720',
        subtitles: 'off',
        soundEffects: 'procedural',
      })
    ).toEqual({
      resolutionPreset: '1280x720',
      subtitles: 'off',
      soundEffects: 'procedural',
    })
  })

  it('falls back to default for null / non-object / invalid preset / extra keys', () => {
    expect(resolveExportSettings(null)).toEqual(DEFAULT_EXPORT_SETTINGS)
    expect(resolveExportSettings('nope')).toEqual(DEFAULT_EXPORT_SETTINGS)
    expect(resolveExportSettings({ resolutionPreset: '9999x9999' })).toEqual(
      DEFAULT_EXPORT_SETTINGS
    )
    expect(
      resolveExportSettings({ resolutionPreset: '1280x720', burnIn: true })
    ).toEqual(DEFAULT_EXPORT_SETTINGS)
    expect(
      resolveExportSettings({ resolutionPreset: '1280x720', subtitles: 'srt' })
    ).toEqual(DEFAULT_EXPORT_SETTINGS)
  })
})

describe('exportSettingsSchema', () => {
  it('accepts every declared preset key', () => {
    for (const key of Object.keys(EXPORT_RESOLUTION_PRESETS) as ResolutionPreset[]) {
      expect(exportSettingsSchema.safeParse({ resolutionPreset: key }).success).toBe(true)
    }
  })

  it('accepts every declared subtitle delivery mode', () => {
    for (const mode of SUBTITLE_DELIVERY_MODES) {
      expect(
        exportSettingsSchema.safeParse({
          resolutionPreset: '1920x1080',
          subtitles: mode,
        }).success
      ).toBe(true)
    }
  })

  it('rejects an invalid preset and unknown keys (strict)', () => {
    expect(exportSettingsSchema.safeParse({ resolutionPreset: '640x480' }).success).toBe(false)
    expect(exportSettingsSchema.safeParse({ resolutionPreset: '1080x1920' }).success).toBe(false)
    expect(
      exportSettingsSchema.safeParse({ resolutionPreset: '1280x720', extra: 1 }).success
    ).toBe(false)
  })
})

describe('exportSettingsPatchSchema', () => {
  it('accepts a single-field patch', () => {
    expect(exportSettingsPatchSchema.safeParse({ subtitles: 'off' })).toMatchObject({
      success: true,
      data: { subtitles: 'off' },
    })
    expect(
      exportSettingsPatchSchema.safeParse({ resolutionPreset: '1280x720' }).success
    ).toBe(true)
    expect(
      exportSettingsPatchSchema.safeParse({ soundEffects: 'procedural' }).success
    ).toBe(true)
  })

  it('rejects an empty patch and unknown keys', () => {
    expect(exportSettingsPatchSchema.safeParse({}).success).toBe(false)
    expect(
      exportSettingsPatchSchema.safeParse({ subtitles: 'off', extra: 1 }).success
    ).toBe(false)
  })
})

describe('mergeExportSettings', () => {
  it('only overwrites the fields present in the patch', () => {
    const current = {
      resolutionPreset: '960x540',
      subtitles: 'off',
      soundEffects: 'procedural',
    } as const
    expect(mergeExportSettings(current, { resolutionPreset: '1280x720' })).toEqual({
      resolutionPreset: '1280x720',
      subtitles: 'off',
      soundEffects: 'procedural',
    })
    expect(mergeExportSettings(current, { subtitles: 'burn-in' })).toEqual({
      resolutionPreset: '960x540',
      subtitles: 'burn-in',
      soundEffects: 'procedural',
    })
  })
})
