import { describe, expect, it } from 'vitest'
import { createValidateShotPlanTool } from './validate-shot-plan'

const validShotPlan = {
  schemaVersion: 1,
  title: '演示分镜',
  shots: [
    {
      id: 'S001',
      blockId: 'B01',
      sourceUnitIds: ['U001'],
      audioBinding: { unitId: 'U001' },
      purpose: { role: 'hook', statement: '提出问题' },
      visualGain: { type: 'contrast', statement: '展示差异', sourceRefs: ['U001'] },
      composition: { mode: 'full-canvas', spatialJourney: '中心向两侧展开' },
      hero: {
        name: '核心对比',
        anatomy: ['左侧', '右侧'],
        material: ['平面色块'],
        scaleIntent: '占据画面主体',
      },
      onScreenText: ['旧流程', '新流程'],
      motion: { dominantAction: '分离', phases: ['进入', '展开'] },
      keyframes: {
        frame0: '空场',
        p25: '主体出现',
        p60: '对比展开',
        p95: '结论稳定',
        end: '保持尾帧',
      },
      capabilities: ['html', 'gsap'],
      assetRefs: ['none'],
      sfxCues: [],
      mustShow: ['对比关系'],
      mustAvoid: ['无关数据'],
    },
  ],
}

describe('createValidateShotPlanTool', () => {
  it('accepts a canonical native shot plan', async () => {
    const result = await createValidateShotPlanTool().execute({ shotPlan: validShotPlan })

    expect(result.details).toMatchObject({ ok: true, shotCount: 1 })
    expect(result.terminate).toBe(true)
  })

  it('returns structured issues for an invalid shot plan', async () => {
    const result = await createValidateShotPlanTool().execute({
      shotPlan: { ...validShotPlan, shots: [] },
    })

    expect(result.details).toMatchObject({ ok: false })
    expect(result.terminate).toBe(false)
  })
})
