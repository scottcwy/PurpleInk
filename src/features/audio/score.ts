import type { ScoreInput, ScoreResult } from './types'

/** PRD F12：接口定稿；Demo 返回占位结果，P1 实现真实整体配乐。 */
export async function generateScore(input: ScoreInput): Promise<ScoreResult> {
  return {
    kind: 'score',
    projectId: input.projectId,
    status: 'placeholder',
    implementation: 'P1',
    note: '占位实现，P1 补齐',
    plan: null,
  }
}
