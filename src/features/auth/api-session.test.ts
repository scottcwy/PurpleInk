import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readSessionToken: vi.fn(),
  resolveSession: vi.fn(),
  runInAuthContext: vi.fn(
    (_context: unknown, callback: () => Promise<Response>) => callback(),
  ),
  recordApiAccess: vi.fn(),
}))

vi.mock('@/lib/auth/session-cookie', () => ({
  readSessionToken: mocks.readSessionToken,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/workspace-context', () => ({
  runInAuthContext: mocks.runInAuthContext,
}))
vi.mock('./session', () => ({ resolveSession: mocks.resolveSession }))
vi.mock('./api-access-counter', () => ({
  recordApiAccess: mocks.recordApiAccess,
}))

import { withAdminSession, withApiSession } from './api-session'

const baseSession = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  email: 'user@example.com',
  name: 'User',
  workspaceName: 'Workspace',
  sessionId: 'session-1',
  role: 'user' as const,
}

describe('API session guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readSessionToken.mockResolvedValue('token')
    mocks.recordApiAccess.mockResolvedValue(undefined)
  })

  it('keeps the existing handler response and records the response outcome', async () => {
    mocks.resolveSession.mockResolvedValue(baseSession)
    mocks.recordApiAccess.mockResolvedValue(undefined)
    const expected = Response.json({ ok: true }, { status: 207 })

    const response = await withApiSession(async () => expected, {
      routeGroup: 'projects',
    })
    await Promise.resolve()

    expect(response).toBe(expected)
    expect(mocks.recordApiAccess).toHaveBeenCalledWith('projects', 207)
  })

  it('returns 401 for an unauthenticated admin API request', async () => {
    mocks.resolveSession.mockResolvedValue(null)

    const response = await withAdminSession(vi.fn(), { routeGroup: 'admin' })

    expect(response.status).toBe(401)
    expect(mocks.recordApiAccess).toHaveBeenCalledWith('admin', 401)
  })

  it('returns 404 without running the handler for a non-admin session', async () => {
    mocks.resolveSession.mockResolvedValue(baseSession)
    const handler = vi.fn()

    const response = await withAdminSession(handler, { routeGroup: 'admin' })

    expect(response.status).toBe(404)
    expect(mocks.recordApiAccess).toHaveBeenCalledWith('admin', 404)
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs an admin handler inside the existing auth context', async () => {
    const session = { ...baseSession, role: 'admin' as const }
    mocks.resolveSession.mockResolvedValue(session)
    const expected = Response.json({ ok: true })
    const handler = vi.fn().mockResolvedValue(expected)

    const response = await withAdminSession(handler)

    expect(response).toBe(expected)
    expect(handler).toHaveBeenCalledWith(session)
    expect(mocks.runInAuthContext).toHaveBeenCalledWith(
      { userId: session.userId, workspaceId: session.workspaceId },
      expect.any(Function),
    )
  })
})
