import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  executeNodeAction: vi.fn(),
  skipNodeAction: vi.fn(),
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
  skipNodeAction: mocks.skipNodeAction,
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

  it('rejects skip without a reason and never touches the action layer', async () => {
    const response = await POST(
      request({ projectId: 'project-1', nodeId: 'node-1', intent: 'skip' })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: '跳过时必须填写原因（1-200 字）',
    })
    expect(mocks.skipNodeAction).not.toHaveBeenCalled()
  })

  it('rejects skipReason on non-skip intents', async () => {
    const response = await POST(
      request({
        projectId: 'project-1',
        nodeId: 'node-1',
        intent: 'execute',
        skipReason: '不该出现',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: '仅 intent=skip 允许携带 skipReason',
    })
    expect(mocks.executeNodeAction).not.toHaveBeenCalled()
  })

  it('rejects skip reasons longer than 200 characters', async () => {
    const response = await POST(
      request({
        projectId: 'project-1',
        nodeId: 'node-1',
        intent: 'skip',
        skipReason: 'x'.repeat(201),
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.skipNodeAction).not.toHaveBeenCalled()
  })

  it('maps SkipRejectedError to 422 with the SKIP_REJECTED code', async () => {
    mocks.skipNodeAction.mockRejectedValue(
      Object.assign(new Error('该环节不支持跳过。'), {
        name: 'SkipRejectedError',
      })
    )
    const response = await POST(
      request({
        projectId: 'project-1',
        nodeId: 'node-1',
        intent: 'skip',
        skipReason: '素材缺失',
      })
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '该环节不支持跳过。',
      code: 'SKIP_REJECTED',
    })
  })

  it('routes skip to skipNodeAction with a trimmed reason', async () => {
    mocks.skipNodeAction.mockResolvedValue({
      ok: true,
      action: 'skip',
      requestedNodeId: 'node-1',
      queuedNodeId: 'node-1',
      jobId: 'attempt-1',
      message: '已跳过此环节',
    })
    const response = await POST(
      request({
        projectId: 'project-1',
        nodeId: 'node-1',
        intent: 'skip',
        skipReason: '  素材缺失，先占位  ',
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: 'skip',
      jobId: 'attempt-1',
    })
    expect(mocks.skipNodeAction).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'node-1',
      reason: '素材缺失，先占位',
    })
    expect(mocks.executeNodeAction).not.toHaveBeenCalled()
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/director/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
