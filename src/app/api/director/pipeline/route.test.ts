import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE, POST } from './route'

const mocks = vi.hoisted(() => ({
  startProjectPipeline: vi.fn(),
  stopProjectPipeline: vi.fn(),
  initQueue: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/director/advance', () => ({
  startProjectPipeline: mocks.startProjectPipeline,
  stopProjectPipeline: mocks.stopProjectPipeline,
}))
vi.mock('@/lib/queue/init', () => ({ initQueue: mocks.initQueue }))

describe('/api/director/pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startProjectPipeline.mockResolvedValue({
      autopilot: true,
      enqueuedNodeIds: ['ingest'],
      failedNodeIds: [],
    })
    mocks.stopProjectPipeline.mockReturnValue({ autopilot: false })
  })

  it('validates the POST body before queue initialization', async () => {
    const response = await POST(request('POST', { projectId: '' }))

    expect(response.status).toBe(400)
    expect(mocks.initQueue).not.toHaveBeenCalled()
    expect(mocks.startProjectPipeline).not.toHaveBeenCalled()
  })

  it('initializes the queue and returns the real start result', async () => {
    const response = await POST(request('POST', { projectId: 'project-1' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      autopilot: true,
      enqueuedNodeIds: ['ingest'],
      failedNodeIds: [],
    })
    expect(mocks.initQueue).toHaveBeenCalledOnce()
    expect(mocks.startProjectPipeline).toHaveBeenCalledWith('project-1')
  })

  it('returns a conflict without leaking an internal stack', async () => {
    mocks.startProjectPipeline.mockRejectedValue(new Error('入口节点当前不可入队'))

    const response = await POST(request('POST', { projectId: 'project-1' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '入口节点当前不可入队',
    })
  })

  it('disables future advancement without initializing the queue', async () => {
    const response = await DELETE(request('DELETE', { projectId: 'project-1' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      autopilot: false,
    })
    expect(mocks.stopProjectPipeline).toHaveBeenCalledWith('project-1')
    expect(mocks.initQueue).not.toHaveBeenCalled()
  })
})

function request(method: 'POST' | 'DELETE', body: unknown): Request {
  return new Request('http://localhost/api/director/pipeline', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
