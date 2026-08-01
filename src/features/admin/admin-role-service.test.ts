import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setUserRoleByEmail: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('./admin-role-repository', () => ({
  setUserRoleByEmail: mocks.setUserRoleByEmail,
}))

import { AdminRoleError, setGlobalUserRole } from './admin-role-service'

describe('setGlobalUserRole', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects revoking the last active administrator', async () => {
    mocks.setUserRoleByEmail.mockResolvedValue({ outcome: 'last_active_admin' })

    await expect(
      setGlobalUserRole({ email: 'ADMIN@EXAMPLE.COM', role: 'user' }),
    ).rejects.toMatchObject({ code: 'LAST_ACTIVE_ADMIN' } satisfies Partial<AdminRoleError>)
    expect(mocks.setUserRoleByEmail).toHaveBeenCalledWith({
      email: 'admin@example.com',
      role: 'user',
    })
  })

  it('rejects an unknown account without creating an administrator', async () => {
    mocks.setUserRoleByEmail.mockResolvedValue({ outcome: 'not_found' })

    await expect(
      setGlobalUserRole({ email: 'missing@example.com', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' } satisfies Partial<AdminRoleError>)
  })
})
