import { beforeEach, describe, expect, it, vi } from 'vitest'

const billing = vi.hoisted(() => ({
  getBillingProjection: vi.fn(),
}))

vi.mock('@/features/billing', () => billing)
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: {
    userId: string
    workspaceId: string
  }) => Promise<Response>) => handler({
    userId: 'user-1',
    workspaceId: 'workspace-1',
  }),
}))

import { GET } from './route'

describe('GET /api/billing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns only the public billing projection', async () => {
    billing.getBillingProjection.mockResolvedValue({
      planKey: 'plus',
      cycle: {
        startsAt: '2026-07-28T00:00:00.000Z',
        endsAt: '2026-08-27T00:00:00.000Z',
      },
      usage: {
        percent: 20,
        remainingPercent: 80,
        invocationCount: 12,
      },
      canRedeem: true,
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.planKey).toBe('plus')
    expect(JSON.stringify(body)).not.toContain('limitCnyMicros')
    expect(JSON.stringify(body)).not.toContain('usedCnyMicros')
  })
})
