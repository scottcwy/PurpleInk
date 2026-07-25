import { describe, expect, it } from 'vitest'
import { shotPlanSchema } from './shot-plan'

describe('shotPlanSchema', () => {
  it('parses a shot matching the source JSON Schema contract', () => {
    expect(shotPlanSchema.parse(validShotPlan()).shots[0]?.id).toBe('S001')
  })

  it('reports the path of a missing required shot field', () => {
    const input = validShotPlan()
    const shot = (input.shots as Array<Record<string, unknown>>)[0]!
    delete shot.hero

    const result = shotPlanSchema.safeParse(input)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['shots', 0, 'hero'])
    }
  })
})

function validShotPlan(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    title: '测试分镜',
    shots: [
      {
        id: 'S001',
        blockId: 'B01',
        sourceUnitIds: ['U001'],
        audioBinding: { unitId: 'U001', startChar: 0, endChar: 4, durationWeight: 1 },
        purpose: { role: 'hook', statement: '建立问题' },
        visualGain: { type: 'contrast', statement: '展示前后差异', sourceRefs: ['U001'] },
        composition: { mode: 'split-world', spatialJourney: '从左侧旧状态转向右侧新状态' },
        hero: {
          name: '对比装置',
          anatomy: ['左侧面板', '右侧面板'],
          material: ['磨砂玻璃'],
          scaleIntent: '占据画面主体',
        },
        onScreenText: ['效率提升'],
        motion: { dominantAction: '左右对照展开', phases: ['进入', '对照', '定格'] },
        keyframes: {
          frame0: '空画布',
          p25: '左侧进入',
          p60: '右侧展开',
          p95: '结论高亮',
          end: '稳定收束',
        },
        capabilities: ['dom'],
        assetRefs: [],
        sfxCues: [{ name: 'whoosh', atMs: 240, volume: 0.6 }],
        mustShow: ['核心结论'],
        mustAvoid: ['无关装饰'],
      },
    ],
  }
}
