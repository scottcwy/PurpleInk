import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  executeNodeAction: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/director', () => ({
  executeNodeAction: mocks.executeNodeAction,
}))

describe('POST /api/render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeNodeAction.mockResolvedValue({
      ok: true,
      action: 'rerender',
      requestedNodeId: 'node-1',
      queuedNodeId: 'node-1',
      jobId: 'job-1',
      message: '已绕过缓存排队重新渲染',
    })
  })

  it('returns 400 for invalid input', async () => {
    const response = await POST(request({ projectId: '', nodeId: 'node-1' }))
    expect(response.status).toBe(400)
    expect(mocks.executeNodeAction).not.toHaveBeenCalled()
  })

  it('returns the accepted rerender action', async () => {
    const input = { projectId: 'project-1', nodeId: 'node-1', intent: 'rerender' }
    const response = await POST(request(input))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: 'rerender',
      jobId: 'job-1',
    })
    expect(mocks.executeNodeAction).toHaveBeenCalledWith(input)
  })

  it('maps asynchronous admission rejection to a conflict response', async () => {
    mocks.executeNodeAction.mockRejectedValueOnce(
      new Error('shot 缺少 window.__CVC_RENDER__ runtime')
    )

    const response = await POST(
      request({ projectId: 'project-1', nodeId: 'node-1', intent: 'repair' })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '上游产物缺失或不包含当前镜头，需要先修复上游阶段。',
      code: 'UPSTREAM_ARTIFACT_MISSING',
    })
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/render', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
