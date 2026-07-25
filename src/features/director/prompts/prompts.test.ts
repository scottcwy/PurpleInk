import { describe, expect, it } from 'vitest'
import {
  buildScoreAssemblePrompt,
  buildShotSfxPrompt,
  buildShotSubtitlePrompt,
} from './assemble'
import { buildDirectPrompt } from './direct'
import { buildFabricatePrompt, buildFabricateRetryPrompt } from './fabricate'
import { buildExportFinalizePrompt, buildShotQaPrompt } from './finalize'
import { buildIngestPrompt } from './ingest'
import { buildShotSpecPrompt, buildShotSpecRetryPrompt } from './shot-spec'

const digest = `sha256:${'a'.repeat(64)}`
const scriptUnits = [{ unitId: 'U001' as const, text: '测试文稿', order: 0 }]
const audioManifest = {
  version: 1,
  engine: 'stepfun-tts',
  units: [
    {
      unitId: 'U001' as const,
      text: '测试文稿',
      audioFile: 'audio/U001.wav',
      durationMs: 1000,
      source: 'tts' as const,
    },
  ],
  totalMs: 1000,
}
const audioAllocation = {
  schemaVersion: 1 as const,
  inputDigests: { audioManifest: digest, runtimeBindings: digest, scriptUnits: digest },
  fps: 30 as const,
  shots: [
    {
      id: 'S001' as const,
      audioUnitId: 'U001' as const,
      scriptRange: { startChar: 0, endChar: 4 },
      substring: '测试文稿',
      startInUnitMs: 0,
      endInUnitMs: 1000,
      startSample: 0,
      endSample: 48000,
      durationInFrames: 30,
      allocationMethod: 'character-anchor' as const,
    },
  ],
  totalFrames: 30,
}
const shot = {
  id: 'S001' as const,
  blockId: 'B01',
  sourceUnitIds: ['U001' as const],
  audioBinding: { unitId: 'U001' as const },
  purpose: { role: 'hook' as const, statement: '建立问题' },
  visualGain: { type: 'contrast' as const, statement: '展示差异', sourceRefs: ['U001'] },
  composition: { mode: 'split-world' as const, spatialJourney: '左右展开' },
  hero: {
    name: '对比装置',
    anatomy: ['左侧', '右侧'],
    material: ['玻璃'],
    scaleIntent: '主体占屏',
  },
  onScreenText: ['结论'],
  motion: { dominantAction: '展开', phases: ['进入', '定格'] },
  keyframes: { frame0: '空', p25: '进入', p60: '展开', p95: '定格', end: '收束' },
  capabilities: ['dom'],
  assetRefs: [],
  sfxCues: [],
  mustShow: ['结论'],
  mustAvoid: ['无关装饰'],
}
const shotPlan = { schemaVersion: 1 as const, title: '测试', shots: [shot] }

describe('director prompt templates', () => {
  it('builds all six project-native stage prompts', () => {
    expect(buildIngestPrompt({ rawScript: '测试文稿' })).toContain('INGEST')
    expect(
      buildDirectPrompt({ projectTitle: '测试', scriptUnits, audioManifest, audioAllocation })
    ).toContain('MASTER_PLAN')
    expect(
      buildShotSpecPrompt({
        scriptUnits,
        audioAllocation,
        masterPlan: '导演总纲',
        styleBible: '风格圣经',
      })
    ).toContain('full-canvas')
    expect(
      buildScoreAssemblePrompt({
        styleBible: '风格圣经',
        shotPlan,
        audioAllocation,
        renderedArtifactKeys: ['shots/S001.mp4'],
      })
    ).toContain('ASSEMBLE')
    expect(
      buildExportFinalizePrompt({
        shotPlan,
        draftArtifactKey: 'draft/final.mp4',
        qaFindings: [],
      })
    ).toContain('ffprobe')
  })

  it('builds per-shot ASSEMBLE and FINALIZE prompts by node role', () => {
    const shotAllocation = audioAllocation.shots[0]!
    expect(
      buildShotSfxPrompt({
        shot,
        scriptUnit: scriptUnits[0]!,
        shotAllocation,
        renderedArtifactKey: 'shots/S001.mp4',
        styleBible: '风格圣经',
      })
    ).toContain('shot-sfx')
    expect(
      buildShotSubtitlePrompt({
        shot,
        scriptUnit: scriptUnits[0]!,
        shotAllocation,
      })
    ).toContain('shot-subtitle')
    expect(
      buildShotQaPrompt({
        shot,
        renderedArtifactKey: 'shots/S001.mp4',
        shotAllocation,
      })
    ).toContain('shot-qa')
  })

  it('ports all ten positive visual laws without omissions', () => {
    const prompts = [
      buildDirectPrompt({ projectTitle: '测试', scriptUnits, audioManifest, audioAllocation }),
      buildShotSpecPrompt({
        scriptUnits,
        audioAllocation,
        masterPlan: '导演总纲',
        styleBible: '风格圣经',
      }),
      buildFabricatePrompt({ shot, audioAllocation, styleBible: '风格圣经' }),
    ].join('\n')
    for (let index = 1; index <= 10; index += 1) {
      expect(prompts).toContain(`正向视觉法则 ${index}`)
    }
  })

  it('states every deterministic FABRICATE prohibition explicitly', () => {
    const prompt = buildFabricatePrompt({ shot, audioAllocation, styleBible: '风格圣经' })
    for (const term of [
      'requestAnimationFrame',
      'gsap.ticker',
      'Date.now()',
      'performance.now()',
      'Math.random()',
      'setTimeout/setInterval',
      'CSS animation/transition',
      'paused timeline',
      'seek',
      'window.__CVC_RENDER__ = { version: 1, seek(frame, fps) }',
      '第一个字符必须是 <',
      '禁止 Markdown 围栏',
    ]) {
      expect(prompt).toContain(term)
    }
  })

  it('builds typed gate feedback prompts with exact violations and full-output instructions', () => {
    const fabricateRetry = buildFabricateRetryPrompt({
      retry: 1,
      maxRetries: 2,
      errors: ['set-interval@457: 禁止 setInterval 驱动动画'],
    })
    expect(fabricateRetry).toContain('set-interval@457')
    expect(fabricateRetry).toContain('第 1/2 次')
    expect(fabricateRetry).toContain('重新输出完整 HTML')

    const shotSpecRetry = buildShotSpecRetryPrompt({
      retry: 2,
      maxRetries: 2,
      errors: ['shots.0.mustShow: Required'],
    })
    expect(shotSpecRetry).toContain('shots.0.mustShow')
    expect(shotSpecRetry).toContain('第 2/2 次')
    expect(shotSpecRetry).toContain('完整 JSON')
  })
})
