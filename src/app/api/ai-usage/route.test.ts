import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  projection: vi.fn(),
  session: {
    userId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
  },
}))

vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: typeof mocks.session) => Promise<Response>) =>
    handler(mocks.session),
}))
vi.mock('@/features/usage', () => ({
  getAiUsageProjection: mocks.projection,
}))

import { GET } from './route'

beforeEach(() => {
  mocks.projection.mockReset()
  mocks.projection.mockResolvedValue({
    schemaVersion: 1,
    view: 'account',
    range: '7d',
    timeZone: 'Asia/Shanghai',
  })
})

describe('GET /api/ai-usage', () => {
  it('locks account scope to the authenticated user', async () => {
    const response = await GET(new Request(
      'http://localhost/api/ai-usage?view=account&range=7d&timeZone=Asia%2FShanghai',
    ))
    expect(response.status).toBe(200)
    expect(mocks.projection).toHaveBeenCalledWith({
      userId: mocks.session.userId,
      view: 'account',
      range: '7d',
      timeZone: 'Asia/Shanghai',
    })
  })

  it.each([
    'view=account&range=cycle&timeZone=UTC',
    'view=managed-cycle&range=7d&timeZone=UTC',
    'view=account&range=7d&timeZone=Not%2FAZone',
    'view=account&range=year&timeZone=UTC',
  ])('rejects invalid query: %s', async (query) => {
    const response = await GET(
      new Request(`http://localhost/api/ai-usage?${query}`),
    )
    expect(response.status).toBe(400)
    expect(mocks.projection).not.toHaveBeenCalled()
  })
})
