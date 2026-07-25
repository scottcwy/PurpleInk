import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_RESOLUTION_PRESETS,
  MASTER_HEIGHT,
  MASTER_RESOLUTION_PRESET,
  MASTER_WIDTH,
  exportSettingsSchema,
  resolutionForPreset,
  resolveExportSettings,
  type ResolutionPreset,
} from './export-settings'

describe('export-settings presets', () => {
  it('keeps every preset at a 9:16 portrait ratio', () => {
    for (const preset of Object.values(EXPORT_RESOLUTION_PRESETS)) {
      expect(preset.width / preset.height).toBeCloseTo(9 / 16, 5)
    }
  })

  it('anchors the master preset at 1080×1920', () => {
    expect(MASTER_RESOLUTION_PRESET).toBe('1080x1920')
    expect(MASTER_WIDTH).toBe(1080)
    expect(MASTER_HEIGHT).toBe(1920)
    expect(EXPORT_RESOLUTION_PRESETS[MASTER_RESOLUTION_PRESET]).toMatchObject({
      width: 1080,
      height: 1920,
    })
    expect(DEFAULT_EXPORT_SETTINGS).toEqual({ resolutionPreset: '1080x1920' })
  })

  it('maps a preset key to its physical resolution', () => {
    expect(resolutionForPreset('540x960')).toEqual({ width: 540, height: 960 })
  })
})

describe('resolveExportSettings', () => {
  it('passes through a valid preset', () => {
    expect(resolveExportSettings({ resolutionPreset: '720x1280' })).toEqual({
      resolutionPreset: '720x1280',
    })
  })

  it('falls back to default for null / non-object / invalid preset / extra keys', () => {
    expect(resolveExportSettings(null)).toEqual(DEFAULT_EXPORT_SETTINGS)
    expect(resolveExportSettings('nope')).toEqual(DEFAULT_EXPORT_SETTINGS)
    expect(resolveExportSettings({ resolutionPreset: '9999x9999' })).toEqual(
      DEFAULT_EXPORT_SETTINGS
    )
    expect(
      resolveExportSettings({ resolutionPreset: '720x1280', burnIn: true })
    ).toEqual(DEFAULT_EXPORT_SETTINGS)
  })
})

describe('exportSettingsSchema', () => {
  it('accepts every declared preset key', () => {
    for (const key of Object.keys(EXPORT_RESOLUTION_PRESETS) as ResolutionPreset[]) {
      expect(exportSettingsSchema.safeParse({ resolutionPreset: key }).success).toBe(true)
    }
  })

  it('rejects an invalid preset and unknown keys (strict)', () => {
    expect(exportSettingsSchema.safeParse({ resolutionPreset: '640x480' }).success).toBe(false)
    expect(
      exportSettingsSchema.safeParse({ resolutionPreset: '720x1280', extra: 1 }).success
    ).toBe(false)
  })
})
