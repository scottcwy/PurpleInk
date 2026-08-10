import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import type { ShotPlan } from '../contracts'
import { probeDuration } from './ffmpeg'
import {
  SOUND_EFFECT_PRESETS,
  buildSoundEffectMix,
  resolveSoundEffectCues,
  soundEffectPromptCatalog,
} from './sound-effects'

const roots: string[] = []
const assetRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/sfx')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('built-in sound effects', () => {
  it('ships exactly 20 unique non-empty CC0 presets', async () => {
    expect(SOUND_EFFECT_PRESETS).toHaveLength(20)
    expect(new Set(SOUND_EFFECT_PRESETS.map((preset) => preset.id)).size).toBe(20)
    expect(soundEffectPromptCatalog()).not.toContain('\uFFFD')
    for (const preset of SOUND_EFFECT_PRESETS) {
      const path = join(assetRoot, preset.file)
      await access(path)
      expect((await stat(path)).size).toBeGreaterThan(1_000)
      expect(preset.durationSec).toBeGreaterThan(0)
      expect(preset.volume).toBeGreaterThan(0)
      expect(preset.volume).toBeLessThanOrEqual(0.35)
    }
    expect(await readFile(join(assetRoot, 'CREDITS.md'), 'utf8')).toContain('Creative Commons CC0')
  })

  it('maps normalized shot positions after real narration durations are known', () => {
    const plans = [
      shot('S001', 10, [
        { at: 0.25, preset: 'whoosh-soft' },
        { at: 0.5, preset: 'not-in-catalog' },
      ]),
      shot('S002', 4, [{ at: 0.5, preset: 'impact-soft' }]),
    ]

    const result = resolveSoundEffectCues(plans)

    expect(result.durationSec).toBe(14)
    expect(result.skippedPresetCount).toBe(1)
    expect(result.cues.map((cue) => [cue.shotId, cue.absoluteTimeSec])).toEqual([
      ['S001', 2.5],
      ['S002', 12],
    ])
  })

  it('renders a deterministic local SFX stem and mixes it with or without narration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'purpleink-sfx-mix-'))
    roots.push(root)

    const result = await buildSoundEffectMix({
      mode: 'auto',
      plans: [
        shot('S001', 7, [
          { at: 0.18, preset: 'whoosh-soft' },
          { at: 0.62, preset: 'impact-soft' },
        ]),
        shot('S002', 7, [
          { at: 0.18, preset: 'whoosh-soft' },
          { at: 0.62, preset: 'impact-soft' },
        ]),
      ],
      narrationPath: null,
      outputDir: root,
    })

    expect(result.status).toBe('mixed')
    expect(result.cueCount).toBe(4)
    expect(result.audioPath).toBe(result.masterPath)
    await access(result.sfxPath!)
    await access(result.masterPath!)
    expect(await probeDuration(result.masterPath!)).toBeCloseTo(14, 1)
    expect(JSON.parse(await readFile(result.cuePlanPath!, 'utf8'))).toMatchObject({
      durationSec: 14,
      skippedPresetCount: 0,
    })

    const narrated = await buildSoundEffectMix({
      mode: 'auto',
      plans: [shot('S001', 14, [{ at: 0.5, preset: 'confirm-chime' }])],
      narrationPath: result.sfxPath!,
      outputDir: join(root, 'with-narration'),
    })
    expect(narrated.status).toBe('mixed')
    expect(narrated.audioPath).toBe(narrated.masterPath)
    expect(await probeDuration(narrated.masterPath!)).toBeCloseTo(14, 1)
  })
})

function shot(id: string, durationSec: number, soundEffects: NonNullable<ShotPlan['soundEffects']>): ShotPlan {
  return {
    id,
    sourceUnitId: `U${id.slice(1)}`,
    purpose: '测试音效时间映射。',
    visualIntent: '强调',
    composition: 'diagram',
    visualDescription: '主视觉在音效时间点发生明确变化。',
    facts: ['事实'],
    onScreenText: ['事实'],
    soundEffects,
    durationSec,
  }
}
