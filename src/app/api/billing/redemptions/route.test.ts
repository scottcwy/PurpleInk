import { beforeEach, describe, expect, it, vi } from 'vitest'

const billing = vi.hoisted(() => ({
  redeemBillingCode: vi.fn(),
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

import { POST } from './route'

function request(body: unknown, idempotencyKey = 'request-12345678'): Request {
  return new Request('http://localhost/api/billing/redemptions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/billing/redemptions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects malformed input without invoking the service', async () => {
    const response = await POST(request({ code: '' }))
    expect(response.status).toBe(400)
    expect(billing.redeemBillingCode).not.toHaveBeenCalled()
  })

  it('passes the authenticated owner context and never echoes the code', async () => {
    billing.redeemBillingCode.mockResolvedValue({
      ok: true,
      projection: {
        planKey: 'pro',
        cycle: {
          startsAt: '2026-07-28T00:00:00.000Z',
          endsAt: '2026-08-27T00:00:00.000Z',
        },
        usage: { percent: 0, remainingPercent: 100, invocationCount: 0 },
        canRedeem: true,
      },
    })

    const response = await POST(request({ code: 'PI-SECRET-CODE-1234' }))
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(billing.redeemBillingCode).toHaveBeenCalledWith({
      code: 'PI-SECRET-CODE-1234',
      idempotencyKey: 'request-12345678',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(text).not.toContain('PI-SECRET-CODE-1234')
  })

  it.each([
    ['forbidden', 403],
    ['idempotency_conflict', 409],
  ])('maps %s without exposing raw errors', async (code, status) => {
    billing.redeemBillingCode.mockRejectedValue(
      Object.assign(new Error('sensitive database detail'), { code }),
    )
    const response = await POST(request({ code: 'PI-SECRET-CODE-1234' }))
    const body = await response.json()

    expect(response.status).toBe(status)
    expect(body.error).not.toContain('sensitive')
  })

  it.each(['redemption_unavailable', 'lower_tier'])(
    'keeps %s behind the same unavailable response',
    async (code) => {
      billing.redeemBillingCode.mockResolvedValue({ ok: false, code })
      const response = await POST(request({ code: 'PI-SECRET-CODE-1234' }))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe('兑换码无效或不可用')
    },
  )

  it('returns 403 when a non-owner reaches the service boundary', async () => {
    billing.redeemBillingCode.mockResolvedValue({ ok: false, code: 'forbidden' })
    const response = await POST(request({ code: 'PI-SECRET-CODE-1234' }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      ok: false,
      error: '仅工作区 Owner 可以使用兑换码',
    })
  })
})
