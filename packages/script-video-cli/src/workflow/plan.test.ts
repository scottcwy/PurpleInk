import { describe, expect, it } from 'vitest'

import { parseScriptValue } from '../input'
import type { AiClient } from '../ai/openai-compatible'
import { createPlan } from './plan'

const script = parseScriptValue({
  schemaVersion: 1,
  title: 'Demo',
  language: 'zh-CN',
  durationSec: 30,
  visualStyle: 'technical',
  narration: 'off',
  units: [
    { id: 'U001', text: '真实事实一。', visualIntent: 'show' },
    { id: 'U002', text: '真实事实二。', visualIntent: 'compare' },
  ],
})

function fakeClient(overrides: { invalidFacts?: boolean } = {}): AiClient {
  return {
    completeText: async () => 'unused',
    completeJson: async ({ system, user }) => {
      if (system.includes('DIRECT')) {
        return { masterPlan: '一镜一判断。', styleBible: '技术编辑风格。' }
      }
      const unitId = user.includes('U002') ? 'U002' : 'U001'
      return {
        id: unitId === 'U002' ? 'S002' : 'S001',
        sourceUnitId: unitId,
        purpose: '把来源事实变成清晰的视觉判断。',
        visualIntent: '用层级和对比表达来源事实。',
        composition: 'split',
        visualDescription: '左侧显示来源事实，右侧显示关系变化。',
        facts: [overrides.invalidFacts ? '模型新增的事实。' : unitId === 'U002' ? '真实事实二。' : '真实事实一。'],
        onScreenText: ['事实'],
        durationSec: 8,
      }
    },
  }
}

describe('createPlan', () => {
  it('creates one deterministically bound shot per source unit', async () => {
    const result = await createPlan(script, fakeClient())

    expect(result.shots.map((shot) => shot.id)).toEqual(['S001', 'S002'])
    expect(result.shots.map((shot) => shot.sourceUnitId)).toEqual(['U001', 'U002'])
    expect(result.director).toEqual({
      masterPlan: '一镜一判断。',
      styleBible: '技术编辑风格。',
    })
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(result.promptFingerprint).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('repairs one DIRECT schema failure and does not make a third request', async () => {
    let directCalls = 0
    const client = fakeClient()
    const ai: AiClient = {
      completeText: client.completeText,
      completeJson: async (prompt) => {
        if (prompt.user.includes('DIRECT')) {
          directCalls += 1
          return directCalls === 1 ? { masterPlan: '' } : { masterPlan: '修复总纲', styleBible: '修复风格' }
        }
        return client.completeJson(prompt)
      },
    }

    const result = await createPlan(script, ai)

    expect(result.director.masterPlan).toBe('修复总纲')
    expect(directCalls).toBe(2)
  })

  it('rejects a shot that invents a fact outside its source unit', async () => {
    await expect(createPlan(script, fakeClient({ invalidFacts: true }))).rejects.toThrow(/AI_OUTPUT_INVALID/)
  })
})
