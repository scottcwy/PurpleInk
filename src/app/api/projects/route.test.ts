import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => {
  class ProjectCreateInputError extends Error {
    readonly code = 'INVALID_PROJECT_INPUT'
    readonly statusCode = 400
  }
  return {
    createProjectFromRequest: vi.fn(),
    listProjects: vi.fn(),
    ProjectCreateInputError,
  }
})

vi.mock('server-only', () => ({}))
// 会话层单独有 pg 测试覆盖；这里只验路由业务分支，直接以假会话放行。
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: unknown) => Promise<Response>) =>
    handler({
      userId: 'user-1',
      workspaceId: 'ws-1',
      email: 'user@example.com',
      name: '测试用户',
      workspaceName: '测试工作区',
      sessionId: 'session-1',
    }),
}))
vi.mock('@/features/canvas', () => ({ listProjects: mocks.listProjects }))
vi.mock('@/features/projects', () => ({
  createProjectFromRequest: mocks.createProjectFromRequest,
  ProjectCreateInputError: mocks.ProjectCreateInputError,
}))

describe('POST /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createProjectFromRequest.mockResolvedValue({
      project: { id: 'project-1', title: '项目', script: '稿件' },
      entryNodeId: 'entry-1',
    })
  })

  it('returns the transaction-created entry id without querying the graph again', async () => {
    const response = await POST(request({ title: '项目', script: '稿件' }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      project: { id: 'project-1' },
      entryNodeId: 'entry-1',
      ingestNodeId: 'entry-1',
    })
    expect(mocks.createProjectFromRequest).toHaveBeenCalledWith(expect.any(Request))
  })

  it('returns safe input messages for declared request errors', async () => {
    mocks.createProjectFromRequest.mockRejectedValue(
      new mocks.ProjectCreateInputError('录音文件不能超过 100 MiB'),
    )

    const response = await POST(request({ title: '项目', script: '稿件' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PROJECT_INPUT',
      error: '录音文件不能超过 100 MiB',
    })
  })

  it('does not expose database or storage error details', async () => {
    mocks.createProjectFromRequest.mockRejectedValue(
      new Error('postgres password and local storage path'),
    )

    const response = await POST(request({ title: '项目', script: '稿件' }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'PROJECT_CREATE_FAILED',
      error: '项目创建失败，请稍后重试',
    })
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
