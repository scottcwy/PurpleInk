import { describe, expect, it } from 'vitest'
import type { DirectorStageContext } from './runtime-repository'
import { prepareStageResult } from './stage-result'

const digest = `sha256:${'a'.repeat(64)}`
const baseContext = {
  projectId: 'project-1',
  nodeId: 'node-1',
  nodeType: null,
  status: 'pending' as const,
  projectTitle: '测试项目',
  projectScript: '第一句。第二句。',
  resumeSessionKey: undefined,
}

describe('prepareStageResult', () => {
  it('normalizes fenced INGEST JSON and assigns stable shot ids', () => {
    const result = prepareStageResult(
      {
        ...baseContext,
        stage: 'INGEST',
        directorInput: { rawScript: '第一句。第二句。' },
      },
      '```json\n{"scriptUnits":[{"unitId":"U001","text":"第一句。"},{"unitId":"U002","text":"第二句。"}]}\n```'
    )

    const parsed = JSON.parse(result.content)
    expect(parsed.scriptUnits).toEqual([
      { unitId: 'U001', text: '第一句。' },
      { unitId: 'U002', text: '第二句。' },
    ])
    expect(parsed.audioManifest).toMatchObject({ version: 1, engine: 'demo-tts' })
    expect(parsed.audioAllocation).toMatchObject({ schemaVersion: 1, fps: 30 })
    expect(result.ingestShots).toEqual([
      {
        shotId: 'S001',
        sourceUnit: { unitId: 'U001', text: '第一句。' },
      },
      {
        shotId: 'S002',
        sourceUnit: { unitId: 'U002', text: '第二句。' },
      },
    ])
  })

  it('rejects malformed INGEST output before it can become an artifact', () => {
    expect(() =>
      prepareStageResult(
        {
          ...baseContext,
          stage: 'INGEST',
          directorInput: {},
        },
        '{"scriptUnits":[{"unitId":"wrong","text":"内容"}]}'
      )
    ).toThrow()
  })

  it('derives FABRICATE render metadata from trusted allocation', () => {
    const result = prepareStageResult(fabricateContext(), '<!doctype html>')

    expect(result.renderSpec).toMatchObject({
      fps: 30,
      durationInFrames: 45,
      width: 1080,
      height: 1920,
    })
    expect(result.renderSpec?.seed).toEqual(expect.any(Number))
  })
})

function fabricateContext(): DirectorStageContext {
  return {
    ...baseContext,
    stage: 'FABRICATE',
    directorInput: {
      shot: {
        id: 'S001',
        blockId: 'B01',
        sourceUnitIds: ['U001'],
        audioBinding: { unitId: 'U001' },
        purpose: { role: 'hook', statement: '建立问题' },
        visualGain: {
          type: 'contrast',
          statement: '展示差异',
          sourceRefs: ['U001'],
        },
        composition: { mode: 'split-world', spatialJourney: '左右展开' },
        hero: {
          name: '对比装置',
          anatomy: ['左侧', '右侧'],
          material: ['玻璃'],
          scaleIntent: '主体占屏',
        },
        onScreenText: ['结论'],
        motion: { dominantAction: '展开', phases: ['进入', '定格'] },
        keyframes: {
          frame0: '空',
          p25: '进入',
          p60: '展开',
          p95: '定格',
          end: '收束',
        },
        capabilities: ['dom'],
        assetRefs: [],
        sfxCues: [],
        mustShow: ['结论'],
        mustAvoid: ['无关装饰'],
      },
      audioAllocation: {
        schemaVersion: 1,
        inputDigests: {
          audioManifest: digest,
          runtimeBindings: digest,
          scriptUnits: digest,
        },
        fps: 30,
        shots: [
          {
            id: 'S001',
            audioUnitId: 'U001',
            scriptRange: { startChar: 0, endChar: 4 },
            substring: '测试文稿',
            startInUnitMs: 0,
            endInUnitMs: 1500,
            startSample: 0,
            endSample: 72000,
            durationInFrames: 45,
            allocationMethod: 'character-anchor',
          },
        ],
        totalFrames: 45,
      },
      styleBible: '风格圣经',
    },
  }
}
