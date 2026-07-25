import { describe, expect, it, vi } from 'vitest'
import { createDirectorStageEffect } from './stage-effects'

vi.mock('server-only', () => ({}))

const baseContext = {
  projectId: 'project-1',
  nodeId: 'node-1',
  stage: 'ASSEMBLE' as const,
  status: 'pending' as const,
  projectTitle: '项目',
  projectScript: '原稿',
  resumeSessionKey: undefined,
}
const shotAllocation = {
  id: 'S001',
  audioUnitId: 'U001',
  scriptRange: { startChar: 0, endChar: 6 },
  substring: '真实旁白文本',
  startInUnitMs: 0,
  endInUnitMs: 1200,
  startSample: 0,
  endSample: 57600,
  durationInFrames: 36,
  allocationMethod: 'character-anchor',
} as const

function harness() {
  const generateVoiceover = vi.fn(async () => ({ kind: 'voiceover' as const }))
  const generateSubtitle = vi.fn(async () => ({ kind: 'subtitle' as const }))
  const loadVoiceover = vi.fn(async () => ({
    audioArtifactId: 'audio-1',
    audioKey: 'audio/S001.mp3',
    audioBytes: Buffer.from([1, 2, 3]),
    audioFormat: 'mp3' as const,
    durationMs: 1200,
    model: 'stepaudio-2.5-tts',
    nativeCaptions: [],
  }))
  const runRuleQa = vi.fn(async () => ({ passed: true }))
  const runVisionQa = vi.fn(async () => ({ passed: true }))
  return {
    generateVoiceover,
    generateSubtitle,
    loadVoiceover,
    runRuleQa,
    runVisionQa,
    effect: createDirectorStageEffect({
      generateVoiceover,
      generateSubtitle,
      loadVoiceover,
      runRuleQa,
      runVisionQa,
    }),
  }
}

describe('Director stage effects', () => {
  it('routes shot-sfx to real TTS using the persisted script unit text', async () => {
    const target = harness()

    await target.effect({
      ...baseContext,
      nodeType: 'shot-sfx',
      directorInput: {
        shot: { id: 'S001' },
        scriptUnit: { unitId: 'U001', text: '真实旁白文本' },
        shotAllocation,
        renderedArtifactKey: 'render/S001.mp4',
        styleBible: '风格圣经',
      },
    })

    expect(target.generateVoiceover).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'node-1',
      shotId: 'S001',
      text: '真实旁白文本',
    })
    expect(target.generateSubtitle).not.toHaveBeenCalled()
  })

  it('routes shot-subtitle to ASR using the voiceover from the same lane', async () => {
    const target = harness()

    await target.effect({
      ...baseContext,
      nodeType: 'shot-subtitle',
      directorInput: {
        shot: { id: 'S001' },
        scriptUnit: { unitId: 'U001', text: '真实旁白文本' },
        shotAllocation,
      },
    })

    expect(target.loadVoiceover).toHaveBeenCalledWith('project-1', 'S001')
    expect(target.generateSubtitle).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'node-1',
      shotId: 'S001',
      script: '真实旁白文本',
      audioArtifactId: 'audio-1',
      audioKey: 'audio/S001.mp3',
      audioBytes: expect.any(Buffer),
      audioFormat: 'mp3',
    })
  })

  it('is a no-op for Director nodes without an application-domain effect', async () => {
    const target = harness()

    await target.effect({
      ...baseContext,
      nodeType: 'score',
      directorInput: {},
    })

    expect(target.generateVoiceover).not.toHaveBeenCalled()
    expect(target.generateSubtitle).not.toHaveBeenCalled()
    expect(target.loadVoiceover).not.toHaveBeenCalled()
  })

  it('keeps deterministic rule QA and Vision QA as two required shot-qa layers', async () => {
    const target = harness()

    await target.effect({
      ...baseContext,
      stage: 'FINALIZE',
      nodeType: 'shot-qa',
      directorInput: {
        shot: { id: 'S001', mustShow: ['标题'], mustAvoid: ['水印'] },
        renderedArtifactKey: 'render/S001.mp4',
        shotAllocation,
      },
    })

    expect(target.runRuleQa).toHaveBeenCalledWith('project-1', 'node-1')
    expect(target.runVisionQa).toHaveBeenCalledWith({
      projectId: 'project-1',
      qaNodeId: 'node-1',
      shot: { id: 'S001', mustShow: ['标题'], mustAvoid: ['水印'] },
    })
  })
})
