import { describe, expect, it, vi } from 'vitest'
import { generateScore } from './index'

vi.mock('server-only', () => ({}))

describe('generateScore', () => {
  it('returns a typed P1 placeholder without throwing', async () => {
    await expect(generateScore({ projectId: 'project-1' })).resolves.toMatchObject({
      kind: 'score',
      projectId: 'project-1',
      status: 'placeholder',
      implementation: 'P1',
      plan: null,
    })
  })
})
