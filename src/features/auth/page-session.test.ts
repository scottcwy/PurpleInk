import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readSessionToken: vi.fn(),
  resolveSession: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

vi.mock('@/lib/auth/session-cookie', () => ({
  readSessionToken: mocks.readSessionToken,
}))
vi.mock('server-only', () => ({}))
vi.mock('./session', () => ({ resolveSession: mocks.resolveSession }))
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

import { requireAdminSession } from './page-session'

const baseSession = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  email: 'user@example.com',
  name: 'User',
  workspaceName: 'Workspace',
  sessionId: 'session-1',
  role: 'user' as const,
}

describe('requireAdminSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readSessionToken.mockResolvedValue('token')
  })

  it('redirects an unauthenticated request to login with the admin path', async () => {
    mocks.resolveSession.mockResolvedValue(null)

    await expect(requireAdminSession('/admin/security')).rejects.toThrow(
      'REDIRECT:/login?next=%2Fadmin%2Fsecurity',
    )
  })

  it('uses notFound for an authenticated non-admin', async () => {
    mocks.resolveSession.mockResolvedValue(baseSession)

    await expect(requireAdminSession('/admin')).rejects.toThrow('NOT_FOUND')
  })

  it('returns the projected admin session', async () => {
    const session = { ...baseSession, role: 'admin' as const }
    mocks.resolveSession.mockResolvedValue(session)

    await expect(requireAdminSession('/admin')).resolves.toBe(session)
  })
})
