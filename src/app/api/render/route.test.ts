import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  getCanvasGraph: vi.fn(),
  enqueueRenderShot: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/canvas', () => ({ getCanvasGraph: mocks.getCanvasGraph }))
vi.mock('@/features/render/queue-handler', () => ({
  enqueueRenderShot: mocks.enqueueRenderShot,
}))

describe('POST /api/render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCanvasGraph.mockReturnValue({ nodes: [{ id: 'node-1' }], edges: [] })
    mocks.enqueueRenderShot.mockResolvedValue('job-1')
  })

  it('returns 400 for invalid input', async () => {
    const response = await POST(request({ projectId: '', nodeId: 'node-1' }))
    expect(response.status).toBe(400)
    expect(mocks.enqueueRenderShot).not.toHaveBeenCalled()
  })

  it('returns 404 when the node is outside the project', async () => {
    mocks.getCanvasGraph.mockReturnValue({ nodes: [], edges: [] })
    const response = await POST(request({ projectId: 'project-1', nodeId: 'missing' }))
    expect(response.status).toBe(404)
    expect(mocks.enqueueRenderShot).not.toHaveBeenCalled()
  })

  it('returns the accepted render job id', async () => {
    const input = { projectId: 'project-1', nodeId: 'node-1' }
    const response = await POST(request(input))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: 'job-1' })
    expect(mocks.enqueueRenderShot).toHaveBeenCalledWith(input)
  })

  it('maps asynchronous admission rejection to a conflict response', async () => {
    mocks.enqueueRenderShot.mockRejectedValueOnce(
      new Error('shot 缺少 window.__CVC_RENDER__ runtime')
    )

    const response = await POST(
      request({ projectId: 'project-1', nodeId: 'node-1' })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'shot 缺少 window.__CVC_RENDER__ runtime',
    })
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/render', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
