import { describe, expect, it } from 'vitest'
import { scriptUnitSchema } from '../schemas/ingest'
import {
  buildScoreAssemblePrompt,
  buildShotSfxPrompt,
  buildShotSubtitlePrompt,
  shotSfxPromptInputSchema,
  shotSubtitlePromptInputSchema,
} from './assemble'
import { buildDirectPrompt, directPromptInputSchema } from './direct'
import { buildFabricatePrompt, buildFabricateRetryPrompt } from './fabricate'
import { buildExportFinalizePrompt, buildShotQaPrompt } from './finalize'
import { buildIngestPrompt, ingestPromptInputSchema } from './ingest'
import {
  buildShotSpecPrompt,
  buildShotSpecRetryPrompt,
  shotSpecPromptInputSchema,
} from './shot-spec'
import {
  resolveVisualTheme,
  visualThemeConstraint,
} from './visual-theme'

const digest = `sha256:${'a'.repeat(64)}`
/**
 * 真实 INGEST 产物形状：`order` 由 INGEST 提示词显式要求，`speaker` 由合同允许。
 * 下游阶段必须原样接受，fixture 不得退化成 `{ unitId, text }` 的窄形状。
 */
const scriptUnits = [
  { unitId: 'U001' as const, text: '测试文稿', order: 0, speaker: '旁白' },
]
const shotSpecTarget = {
  laneKey: 'S001' as const,
  sourceUnitId: 'U001' as const,
  sourceUnit: scriptUnits[0]!,
}
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
        target: shotSpecTarget,
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
        skippedRenderLanes: [],
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

  it('states semantic split granularity in INGEST and per-shot planning in DIRECT', () => {
    const ingestPrompt = buildIngestPrompt({ rawScript: '测试文稿' })
    expect(ingestPrompt).toContain('1-2 句话一个 unit')
    expect(ingestPrompt).toContain('禁止把多个独立语义点合并进同一个 unit')
    expect(ingestPrompt).toContain('拆分粒度直接决定镜头精度')
    expect(ingestPrompt).toContain('unit 总数不超过 999')

    const directPrompt = buildDirectPrompt({
      projectTitle: '测试',
      scriptUnits,
      audioManifest,
      audioAllocation,
    })
    expect(directPrompt).toContain('一镜一个核心判断')
    expect(directPrompt).toContain('相邻镜头必须变化拓扑、视角或信息职责')
  })

  it('forbids describing degraded FINALIZE input as complete quality approval', () => {
    const prompt = buildExportFinalizePrompt({
      shotPlan,
      draftArtifactKey: 'exports/final.mp4',
      qaFindings: [],
      delivery: {
        mode: 'degraded',
        placeholderLanes: ['S007'],
        waivedQaLanes: ['S007'],
      },
    })

    expect(prompt).toContain('降级交付')
    expect(prompt).toContain('不得描述为完整质量通过')
    expect(prompt).toContain('S007')
  })

  it('ports all ten positive visual laws without omissions', () => {
    const prompts = [
      buildDirectPrompt({ projectTitle: '测试', scriptUnits, audioManifest, audioAllocation }),
      buildShotSpecPrompt({
        target: shotSpecTarget,
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
      '64000 个字符以内',
      '不能因追求细节输出半截 HTML',
      '固定 1920×1080',
      'width=1920, height=1080',
      'data-composition-id',
      'data-width="1920"',
      'data-height="1080"',
      '禁止滚动',
      '横屏安全区',
    ]) {
      expect(prompt).toContain(term)
    }
  })

  it('leads FABRICATE with wishful visual-quality directives', () => {
    const prompt = buildFabricatePrompt({ shot, audioAllocation, styleBible: '风格圣经' })
    expect(prompt).toContain('优先保证视觉效果')
    expect(prompt).toContain('具体设计方向由你自行决策')
    expect(prompt).toContain('拿出你的最强能力')
    expect(prompt).toContain('clip-path 揭示')
    expect(prompt).toContain('禁止为凑长度堆无意义代码')
  })

  it('injects dark/light visual theme hard constraints into DIRECT and FABRICATE', () => {
    const darkDirect = buildDirectPrompt({
      projectTitle: '测试',
      scriptUnits,
      audioManifest,
      audioAllocation,
      visualTheme: 'dark',
    })
    const lightFabricate = buildFabricatePrompt({
      shot,
      audioAllocation,
      styleBible: '风格圣经',
      visualTheme: 'light',
    })
    expect(darkDirect).toContain(visualThemeConstraint('dark'))
    expect(lightFabricate).toContain(visualThemeConstraint('light'))
    expect(
      buildDirectPrompt({
        projectTitle: '测试',
        scriptUnits,
        audioManifest,
        audioAllocation,
      })
    ).toContain(visualThemeConstraint('dark'))
    expect(resolveVisualTheme(undefined)).toBe('dark')
    expect(resolveVisualTheme('light')).toBe('light')
    expect(resolveVisualTheme('neon')).toBe('dark')
  })

  it('places per-shot dynamic context after project-shared context for prompt caching', () => {
    const shotSpecPrompt = buildShotSpecPrompt({
      target: shotSpecTarget,
      scriptUnits,
      audioAllocation,
      masterPlan: '导演总纲',
      styleBible: '风格圣经',
    })
    const shotSpecDynamicAt = shotSpecPrompt.indexOf('当前唯一目标镜头')
    expect(shotSpecDynamicAt).toBeGreaterThan(shotSpecPrompt.indexOf('master plan：'))
    expect(shotSpecDynamicAt).toBeGreaterThan(shotSpecPrompt.indexOf('style bible：'))
    expect(shotSpecDynamicAt).toBeGreaterThan(shotSpecPrompt.indexOf('音频时序'))

    const fabricatePrompt = buildFabricatePrompt({
      shot,
      audioAllocation,
      styleBible: '风格圣经',
    })
    const fabricateDynamicAt = fabricatePrompt.indexOf('shot contract')
    expect(fabricateDynamicAt).toBeGreaterThan(fabricatePrompt.indexOf('style bible：'))
    expect(fabricateDynamicAt).toBeGreaterThan(fabricatePrompt.indexOf('audio allocation'))
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

/**
 * 回归护栏：script unit 的唯一真值是 `schemas/ingest` 的 `scriptUnitSchema`。
 *
 * 真实事故——SHOT_SPEC 把 `target.sourceUnit` 重写成只允许 `{ unitId, text }`
 * 的 strict 形状，导致带 `order` 的真实 INGEST 产物在构建提示词时必然抛
 * `unrecognized_keys`，模型一次都没被调用。任何下游阶段再收窄这份合同，
 * 这里必须先红。
 */
describe('INGEST script unit 合同跨阶段流通', () => {
  const fullUnit = {
    unitId: 'U001' as const,
    text: '测试文稿',
    order: 0,
    speaker: '旁白',
  }

  it('accepts every optional INGEST field in the shared contract', () => {
    expect(scriptUnitSchema.parse(fullUnit)).toEqual(fullUnit)
  })

  it('lets a complete INGEST script unit flow into every downstream consumer', () => {
    const shotAllocation = audioAllocation.shots[0]!
    const consumers: ReadonlyArray<readonly [string, () => unknown]> = [
      [
        'INGEST',
        () =>
          ingestPromptInputSchema.parse({
            rawScript: '原稿',
            existingUnits: [fullUnit],
          }),
      ],
      [
        'DIRECT',
        () =>
          directPromptInputSchema.parse({
            projectTitle: '测试',
            scriptUnits: [fullUnit],
          }),
      ],
      [
        'SHOT_SPEC',
        () =>
          shotSpecPromptInputSchema.parse({
            target: {
              laneKey: 'S001',
              sourceUnitId: fullUnit.unitId,
              sourceUnit: fullUnit,
            },
            scriptUnits: [fullUnit],
            masterPlan: '导演总纲',
            styleBible: '风格圣经',
          }),
      ],
      [
        'ASSEMBLE·shot-sfx',
        () =>
          shotSfxPromptInputSchema.parse({
            shot,
            scriptUnit: fullUnit,
            shotAllocation,
            renderedArtifactKey: 'shots/S001.mp4',
            styleBible: '风格圣经',
          }),
      ],
      [
        'ASSEMBLE·shot-subtitle',
        () =>
          shotSubtitlePromptInputSchema.parse({
            shot,
            scriptUnit: fullUnit,
            shotAllocation,
          }),
      ],
    ]
    for (const [stage, parse] of consumers) {
      expect(parse, `${stage} 必须原样接受 INGEST script unit`).not.toThrow()
    }
  })
})
