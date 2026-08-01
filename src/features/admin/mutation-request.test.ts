import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const createAdminUser = vi.fn(async () => ({ id: 'user-1', workspaceId: 'workspace-1' }))
const updateAdminUser = vi.fn(async () => ({ id: 'user-1' }))
const revokeRedemptionBatch = vi.fn(async () => undefined)
vi.mock('@/features/admin', () => ({
  createAdminUser,
  updateAdminUser,
  revokeRedemptionBatch,
}))
vi.mock('@/features/auth', () => ({
  withAdminSession: async (
    handler: (session: { userId: string }) => Promise<Response>,
  ) => handler({ userId: 'admin-1' }),
}))

const { POST: createAdminUserRoute } = await import('@/app/api/admin/users/route')

beforeEach(() => {
  createAdminUser.mockClear()
  updateAdminUser.mockClear()
  revokeRedemptionBatch.mockClear()
})

const rejectedMutationCases: Array<{
  name: string
  headers: Record<string, string>
  status: number
}> = [
  {
    name: 'text/plain payload',
    headers: { 'content-type': 'text/plain' },
    status: 415,
  },
  {
    name: 'foreign Origin',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    status: 403,
  },
  {
    name: 'same-site fetch metadata',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
    status: 403,
  },
]

describe('admin mutation request boundary', () => {
  it.each(rejectedMutationCases)(
    'rejects $name before invoking the account service',
    async ({ headers, status }) => {
    const response = await createAdminUserRoute(new Request('https://purpleink.example/api/admin/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }))
    expect(response.status).toBe(status)
    expect(createAdminUser).not.toHaveBeenCalled()
    },
  )

  it('accepts JSON with charset and same-origin browser metadata', async () => {
    const response = await createAdminUserRoute(new Request('https://purpleink.example/api/admin/users', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        origin: 'https://purpleink.example',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({
        email: 'new@example.test',
        name: 'New User',
        password: 'A-valid-password-123!',
        workspaceName: 'New Workspace',
      }),
    }))
    expect(response.status).toBe(201)
    expect(createAdminUser).toHaveBeenCalledOnce()
  })
})

describe('admin UUID path boundary', () => {
  it('rejects invalid UUIDs before invoking user or billing services', async () => {
    const { parseAdminUuid } = await import('./http-errors')
    expect(() => parseAdminUuid('not-a-uuid')).toThrow('资源标识格式不正确')
    expect(parseAdminUuid('71000000-0000-4000-8000-000000000001'))
      .toBe('71000000-0000-4000-8000-000000000001')
  })

  it('returns 400 before user and billing services receive malformed path IDs', async () => {
    const request = (url: string, body: object) => new Request(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const [{ PATCH: patchUser }, { PATCH: patchBatch }] = await Promise.all([
      import('@/app/api/admin/users/[id]/route'),
      import('@/app/api/admin/billing/batches/[id]/route'),
    ])
    const context = { params: Promise.resolve({ id: 'not-a-uuid' }) }
    const [userResponse, batchResponse] = await Promise.all([
      patchUser(request('https://purpleink.example/api/admin/users/not-a-uuid', {
        name: 'No service call',
      }), context),
      patchBatch(request('https://purpleink.example/api/admin/billing/batches/not-a-uuid', {
        action: 'revoke',
        confirmation: 'REVOKE',
      }), context),
    ])
    expect(userResponse.status).toBe(400)
    expect(batchResponse.status).toBe(400)
    expect(updateAdminUser).not.toHaveBeenCalled()
    expect(revokeRedemptionBatch).not.toHaveBeenCalled()
  })
})
