import { describe, expect, it } from 'vitest'
import {
  deliveryForSubtitles,
  deliveryFromSchemaVersion,
  finalVideoDeliveryLabel,
  finalVideoSchemaVersion,
} from './final-video-delivery'

describe('final video delivery', () => {
  it('mints a distinct schemaVersion per subtitle delivery', () => {
    expect(finalVideoSchemaVersion('burn-in')).toBe('cvc.final-video/v2')
    expect(finalVideoSchemaVersion('off')).toBe('cvc.final-video/v3')
  })

  it('keeps the existing v2 contract for burned-in subtitles', () => {
    // 存量成片全是 v2，这个映射不能漂：漂了以前的成片会被重述为别的交付。
    expect(deliveryFromSchemaVersion('cvc.final-video/v2')).toBe(
      'narration-hard-subtitle-v2'
    )
    expect(deliveryForSubtitles('burn-in')).toBe('narration-hard-subtitle-v2')
  })

  it('round-trips the subtitle-free delivery', () => {
    expect(deliveryForSubtitles('off')).toBe('narration-no-subtitle-v3')
    expect(
      deliveryFromSchemaVersion(finalVideoSchemaVersion('off'))
    ).toBe('narration-no-subtitle-v3')
  })

  it('treats unknown and pre-v2 versions as the legacy silent export', () => {
    expect(deliveryFromSchemaVersion('cvc.final-video/v1')).toBe('legacy-silent-v1')
    expect(deliveryFromSchemaVersion('')).toBe('legacy-silent-v1')
    expect(deliveryFromSchemaVersion('cvc.something-else/v9')).toBe(
      'legacy-silent-v1'
    )
  })

  it('gives every delivery a distinct human label', () => {
    const labels = (
      ['legacy-silent-v1', 'narration-hard-subtitle-v2', 'narration-no-subtitle-v3'] as const
    ).map(finalVideoDeliveryLabel)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual([
      '旧版静音成片',
      '旁白 + 硬字幕烧录',
      '旁白 · 无字幕',
    ])
  })
})
