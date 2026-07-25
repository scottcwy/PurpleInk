import { describe, expect, it, vi } from 'vitest'
import type { NarrationInput, NarrationResult } from '@/features/audio'
import type { DirectorStageContext } from './runtime-repository'
import { prepareStageResult, type StageResultDependencies } from './stage-result'

const digest = `sha256:${'a'.repeat(64)}`

/** 每个 unit 的实测时长由文本长度以外的真实音频决定，这里用可控实测值替代。 */
function narrationStub(durationsMs: readonly number[]): StageResultDependencies {
  return {
    synthesizeNarration: vi.fn(
      async (input: NarrationInput): Promise<NarrationResult> => ({
        engine: 'stepaudio-2.5-tts',
        voice: 'cixingnansheng',
        units: input.units.map((unit, index) => ({
          unitId: unit.unitId,
          text: unit.text,
          audioKey: `narration/project-1/${unit.unitId}.mp3`,
          audioArtifactId: `artifact-${unit.unitId}`,
          contentHash: 'c'.repeat(64),
          durationMs: durationsMs[index] ?? 1000,
          sampleRateHz: 24_000,
          sampleCount: Math.round(
            ((durationsMs[index] ?? 1000) * 24_000) / 1000
          ),
          nativeCaptions: [],
          reused: false,
        })),
      })
    ),
  }
}
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
  it('normalizes fenced INGEST JSON and assigns stable shot ids', async () => {
    const dependencies = narrationStub([1583.375, 7216.5])
    const result = await prepareStageResult(
      {
        ...baseContext,
        stage: 'INGEST',
        directorInput: { rawScript: '第一句。第二句。' },
      },
      '```json\n{"scriptUnits":[{"unitId":"U001","text":"第一句。"},{"unitId":"U002","text":"第二句。"}]}\n```',
      dependencies
    )

    const parsed = JSON.parse(result.content)
    expect(parsed.scriptUnits).toEqual([
      { unitId: 'U001', text: '第一句。' },
      { unitId: 'U002', text: '第二句。' },
    ])
    expect(parsed.audioManifest).toMatchObject({
      version: 1,
      engine: 'stepaudio-2.5-tts',
      contractVersion: 'vnext-audio-v1',
    })
    expect(parsed.audioManifest.units.map((unit: { durationMs: number }) => unit.durationMs))
      .toEqual([1583.375, 7216.5])
    expect(parsed.audioAllocation).toMatchObject({ schemaVersion: 1, fps: 30 })
    expect(
      parsed.audioAllocation.shots.map(
        (shot: { durationInFrames: number }) => shot.durationInFrames
      )
    ).toEqual([48, 217])
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

  it('rejects malformed INGEST output before any TTS call happens', async () => {
    const dependencies = narrationStub([1000])

    await expect(
      prepareStageResult(
        {
          ...baseContext,
          stage: 'INGEST',
          directorInput: {},
        },
        '{"scriptUnits":[{"unitId":"wrong","text":"内容"}]}',
        dependencies
      )
    ).rejects.toThrow()
    expect(dependencies.synthesizeNarration).not.toHaveBeenCalled()
  })

  it('fails INGEST without any artifact content when TTS is unavailable', async () => {
    await expect(
      prepareStageResult(
        {
          ...baseContext,
          stage: 'INGEST',
          directorInput: { rawScript: '第一句。' },
        },
        '{"scriptUnits":[{"unitId":"U001","text":"第一句。"}]}',
        {
          synthesizeNarration: async () => {
            throw new Error('尚未配置 StepFun API Key')
          },
        }
      )
    ).rejects.toThrow('StepFun API Key')
  })

  it('derives FABRICATE render metadata from trusted allocation', async () => {
    const result = await prepareStageResult(fabricateContext(), '<!doctype html>')

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
