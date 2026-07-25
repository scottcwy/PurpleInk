import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  getCanvasGraph: vi.fn(),
  enqueueDirectorStage: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/canvas', () => ({ getCanvasGraph: mocks.getCanvasGraph }))
vi.mock('@/features/director/queue-handler', () => ({
  enqueueDirectorStage: mocks.enqueueDirectorStage,
}))

describe('POST /api/director/stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCanvasGraph.mockReturnValue({
      nodes: [{ id: 'node-1' }],
      edges: [],
    })
    mocks.enqueueDirectorStage.mockReturnValue('job-1')
  })

  it('returns 400 with a clear message for invalid input', async () => {
    const response = await POST(request({ projectId: '', stage: 'UNKNOWN' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
    expect(mocks.enqueueDirectorStage).not.toHaveBeenCalled()
  })

  it('returns 404 when the node is not in the requested project', async () => {
    mocks.getCanvasGraph.mockReturnValue({ nodes: [], edges: [] })
    const response = await POST(
      request({ projectId: 'project-1', nodeId: 'missing', stage: 'INGEST' })
    )

    expect(response.status).toBe(404)
    expect(mocks.enqueueDirectorStage).not.toHaveBeenCalled()
  })

  it('returns the accepted job id', async () => {
    const input = { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' }
    const response = await POST(request(input))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, jobId: 'job-1' })
    expect(mocks.enqueueDirectorStage).toHaveBeenCalledWith(input)
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/director/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
