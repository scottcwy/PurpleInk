import { describe, expect, it, vi } from 'vitest'
import type { SessionOwner } from './session'

/**
 * withAdminSession 的角色拦截契约：
 * - 未登录 → 401（withApiSession 兜底）
 * - 已登录非 admin → 404（不暴露 /api/admin 表面存在，handler 不得执行）
 * - admin → 放行，handler 在归属上下文内执行
 */

vi.mock('server-only', () => ({}))
const readSessionTokenMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session-cookie', () => ({
  readSessionToken: readSessionTokenMock,
}))
const resolveSessionMock = vi.hoisted(() => vi.fn())
vi.mock('./session', () => ({ resolveSession: resolveSessionMock }))

function owner(role: string): SessionOwner {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    email: 'someone@example.com',
    name: '某用户',
    role,
    workspaceName: 'Workspace',
    sessionId: '33333333-3333-4333-8333-333333333333',
  }
}

describe('withAdminSession', () => {
  it('rejects anonymous requests with 401', async () => {
    const { withAdminSession } = await import('./api-session')
    readSessionTokenMock.mockResolvedValue(null)
    resolveSessionMock.mockResolvedValue(null)
    const handler = vi.fn()

    const response = await withAdminSession(handler)

    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 404 for signed-in non-admin users without running the handler', async () => {
    const { withAdminSession } = await import('./api-session')
    readSessionTokenMock.mockResolvedValue('token')
    resolveSessionMock.mockResolvedValue(owner('user'))
    const handler = vi.fn()

    const response = await withAdminSession(handler)

    expect(response.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs the handler inside the auth context for admins', async () => {
    const { withAdminSession } = await import('./api-session')
    const { currentWorkspaceId } = await import('@/lib/auth/workspace-context')
    readSessionTokenMock.mockResolvedValue('token')
    const admin = owner('admin')
    resolveSessionMock.mockResolvedValue(admin)

    const response = await withAdminSession(async (session) => {
      // 归属上下文必须已建立：admin API 与普通 API 同一套上下文纪律。
      expect(currentWorkspaceId()).toBe(admin.workspaceId)
      expect(session.role).toBe('admin')
      return new Response(null, { status: 204 })
    })

    expect(response.status).toBe(204)
  })
})
