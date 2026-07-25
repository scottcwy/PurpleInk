import type { SfxInput, SfxResult } from './types'

/** PRD F14：接口定稿；Demo 返回占位结果，P1 实现真实分镜音效。 */
export async function generateSfx(input: SfxInput): Promise<SfxResult> {
  return {
    kind: 'sfx',
    shotId: input.shotId,
    status: 'placeholder',
    implementation: 'P1',
    note: '占位实现，P1 补齐',
    cues: [],
  }
}
