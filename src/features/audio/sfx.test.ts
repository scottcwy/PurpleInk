import { describe, expect, it, vi } from 'vitest'
import { generateSfx } from './index'

vi.mock('server-only', () => ({}))

describe('generateSfx', () => {
  it('returns a typed P1 placeholder without throwing', async () => {
    await expect(generateSfx({ shotId: 'S001' })).resolves.toMatchObject({
      kind: 'sfx',
      shotId: 'S001',
      status: 'placeholder',
      implementation: 'P1',
      cues: [],
    })
  })
})
