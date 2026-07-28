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
  const generateSubtitle = vi.fn(async () => ({ kind: 'subtitle' as const }))
  const loadNarration = vi.fn(async (_projectId: string, unitId: string) => ({
    unitId,
    audioArtifactId: 'audio-1',
    audioKey: 'narration/project-1/u001.mp3',
    audioBytes: Buffer.from([1, 2, 3]),
    audioFormat: 'mp3' as const,
    contentHash: 'c'.repeat(64),
    sizeBytes: 3,
  }))
  const runRuleQa = vi.fn(async () => ({ passed: true }))
  const runVisionQa = vi.fn(async () => ({ passed: true }))
  return {
    generateSubtitle,
    loadNarration,
    runRuleQa,
    runVisionQa,
    effect: createDirectorStageEffect({
      generateSubtitle,
      loadNarration,
      runRuleQa,
      runVisionQa,
    }),
  }
}

describe('Director stage effects', () => {
  it('makes shot-sfx consume the INGEST narration instead of synthesizing again', async () => {
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

    expect(target.loadNarration).toHaveBeenCalledWith('project-1', 'U001')
    expect(target.generateSubtitle).not.toHaveBeenCalled()
  })

  it('routes shot-subtitle to ASR using the narration from the same unit', async () => {
    const target = harness()

    await target.effect({
      ...baseContext,
      attemptId: 'attempt-1',
      nodeType: 'shot-subtitle',
      directorInput: {
        shot: { id: 'S001' },
        scriptUnit: { unitId: 'U001', text: '真实旁白文本' },
        shotAllocation,
      },
    })

    expect(target.loadNarration).toHaveBeenCalledWith('project-1', 'U001')
    expect(target.generateSubtitle).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'node-1',
      shotId: 'S001',
      script: '真实旁白文本',
      audioArtifactId: 'audio-1',
      audioKey: 'narration/project-1/u001.mp3',
      audioBytes: expect.any(Buffer),
      audioFormat: 'mp3',
      billingContext: {
        attemptId: 'attempt-1',
        invocationNo: 100,
      },
    })
  })

  it('is a no-op for Director nodes without an application-domain effect', async () => {
    const target = harness()

    await target.effect({
      ...baseContext,
      nodeType: 'score',
      directorInput: {},
    })

    expect(target.generateSubtitle).not.toHaveBeenCalled()
    expect(target.loadNarration).not.toHaveBeenCalled()
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
