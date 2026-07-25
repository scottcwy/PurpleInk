import { describe, expect, it } from 'vitest'
import { buildStagePrompt } from './stage-prompt'

const digest = `sha256:${'a'.repeat(64)}`
const shotAllocation = {
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
}
const audioAllocation = {
  schemaVersion: 1 as const,
  inputDigests: { audioManifest: digest, runtimeBindings: digest, scriptUnits: digest },
  fps: 30 as const,
  shots: [shotAllocation],
  totalFrames: 30,
}
const shotPlan = { schemaVersion: 1 as const, shots: [{ id: 'S001' as const }] }

describe('buildStagePrompt', () => {
  it('uses the persisted project script as the INGEST fallback', () => {
    const prompt = buildStagePrompt('INGEST', {
      projectTitle: '演示项目',
      projectScript: '这是一段待拆分的原始脚本。',
      nodeType: 'script-import',
      directorInput: undefined,
    })

    expect(prompt).toContain('这是一段待拆分的原始脚本。')
    expect(prompt).toContain('INGEST')
  })

  it('rejects missing typed input for downstream stages', () => {
    expect(() =>
      buildStagePrompt('DIRECT', {
        projectTitle: '演示项目',
        projectScript: '原稿',
        nodeType: 'shot-split',
        directorInput: undefined,
      })
    ).toThrow()
  })

  it('routes ASSEMBLE to the builder that matches the node role', () => {
    const score = buildStagePrompt('ASSEMBLE', {
      projectTitle: '演示项目',
      projectScript: '原稿',
      nodeType: 'score',
      directorInput: {
        styleBible: '风格圣经',
        shotPlan,
        audioAllocation,
        renderedArtifactKeys: ['shots/S001.mp4'],
      },
    })
    expect(score).toContain('score 全局节点')

    const sfx = buildStagePrompt('ASSEMBLE', {
      projectTitle: '演示项目',
      projectScript: '原稿',
      nodeType: 'shot-sfx',
      directorInput: {
        shot: { id: 'S001' },
        scriptUnit: { unitId: 'U001', text: '测试文稿' },
        shotAllocation,
        renderedArtifactKey: 'shots/S001.mp4',
        styleBible: '风格圣经',
      },
    })
    expect(sfx).toContain('shot-sfx 分镜通道')

    const subtitle = buildStagePrompt('ASSEMBLE', {
      projectTitle: '演示项目',
      projectScript: '原稿',
      nodeType: 'shot-subtitle',
      directorInput: {
        shot: { id: 'S001' },
        scriptUnit: { unitId: 'U001', text: '测试文稿' },
        shotAllocation,
      },
    })
    expect(subtitle).toContain('shot-subtitle 分镜通道')
  })

  it('routes FINALIZE to the builder that matches the node role', () => {
    const exportPrompt = buildStagePrompt('FINALIZE', {
      projectTitle: '演示项目',
      projectScript: '原稿',
      nodeType: 'export',
      directorInput: {
        shotPlan,
        draftArtifactKey: 'draft/final.mp4',
        qaFindings: [],
      },
    })
    expect(exportPrompt).toContain('export 全局节点')

    const qa = buildStagePrompt('FINALIZE', {
      projectTitle: '演示项目',
      projectScript: '原稿',
      nodeType: 'shot-qa',
      directorInput: {
        shot: { id: 'S001' },
        renderedArtifactKey: 'shots/S001.mp4',
        shotAllocation,
      },
    })
    expect(qa).toContain('shot-qa 分镜通道')
  })

  it('rejects unknown node types within ASSEMBLE and FINALIZE', () => {
    expect(() =>
      buildStagePrompt('ASSEMBLE', {
        projectTitle: '演示项目',
        projectScript: '原稿',
        nodeType: 'mystery',
        directorInput: {},
      })
    ).toThrow('未知 ASSEMBLE 节点类型')
    expect(() =>
      buildStagePrompt('FINALIZE', {
        projectTitle: '演示项目',
        projectScript: '原稿',
        nodeType: null,
        directorInput: {},
      })
    ).toThrow('未知 FINALIZE 节点类型')
  })
})
