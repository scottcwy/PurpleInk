import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  getCanvasGraph: vi.fn(),
  listProjects: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/canvas', () => mocks)

describe('POST /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createProject.mockReturnValue({ id: 'project-1', title: '项目', script: '稿件' })
    mocks.getCanvasGraph.mockReturnValue({
      nodes: [{ id: 'ingest-1', type: 'script-import' }],
      edges: [],
    })
  })

  it('returns the trusted INGEST node id created with the project', async () => {
    const response = await POST(request({ title: '项目', script: '稿件' }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      project: { id: 'project-1' },
      ingestNodeId: 'ingest-1',
    })
  })

  it('rejects an incomplete initial graph', async () => {
    mocks.getCanvasGraph.mockReturnValue({ nodes: [], edges: [] })

    const response = await POST(request({ title: '项目', script: '稿件' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: '项目初始 INGEST 节点创建失败',
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
