import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  executeNodeAction: vi.fn(),
}))

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
vi.mock('@/features/director', () => ({
  executeNodeAction: mocks.executeNodeAction,
}))

describe('POST /api/director/stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeAction.mockResolvedValue({
      ok: true,
      action: 'execute',
      requestedNodeId: 'node-1',
      queuedNodeId: 'node-1',
      jobId: 'job-1',
      message: '已排队执行此阶段',
    })
  })

  it('returns 400 with a clear message for invalid input', async () => {
    const response = await POST(request({ projectId: '', intent: 'execute' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
    expect(mocks.executeNodeAction).not.toHaveBeenCalled()
  })

  it('returns a conflict when recovery admission rejects the action', async () => {
    mocks.executeNodeAction.mockRejectedValue(new Error('节点不存在：missing'))
    const response = await POST(
      request({ projectId: 'project-1', nodeId: 'missing', intent: 'repair' })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '上游产物缺失或不包含当前镜头，需要先修复上游阶段。',
      code: 'UPSTREAM_ARTIFACT_MISSING',
    })
  })

  it('returns the actual recovery action and queued node', async () => {
    const input = { projectId: 'project-1', nodeId: 'node-1', intent: 'repair' }
    const response = await POST(request(input))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: 'execute',
      queuedNodeId: 'node-1',
      jobId: 'job-1',
    })
    expect(mocks.executeNodeAction).toHaveBeenCalledWith(input)
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/director/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
