import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  ensureShotQaChecked: vi.fn(),
  exportProject: vi.fn(),
  getExportReadiness: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/render/export-service', () => ({
  ensureShotQaChecked: mocks.ensureShotQaChecked,
  exportProject: mocks.exportProject,
  getExportReadiness: mocks.getExportReadiness,
}))

describe('POST /api/render/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for invalid input', async () => {
    const response = await POST(request({ projectId: '' }))
    expect(response.status).toBe(400)
    expect(mocks.exportProject).not.toHaveBeenCalled()
  })

  it('returns every incomplete node with status 409', async () => {
    mocks.exportProject.mockResolvedValue({
      ok: false,
      incompleteNodeIds: ['node-1', 'node-2'],
    })
    const response = await POST(request({ projectId: 'project-1' }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      incompleteNodeIds: ['node-1', 'node-2'],
    })
  })

  it('returns the trusted export result', async () => {
    mocks.exportProject.mockResolvedValue({
      ok: true,
      artifactId: 'artifact-final',
      outputKey: 'exports/project-1/final.mp4',
      contentHash: 'hash',
    })
    const response = await POST(request({ projectId: 'project-1' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      artifactUrl: '/api/artifacts/artifact-final?projectId=project-1',
    })
    expect(mocks.exportProject).toHaveBeenCalledWith('project-1')
  })
})

describe('GET /api/render/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a controlled URL for the latest final artifact', async () => {
    mocks.getExportReadiness.mockReturnValue({
      ready: true,
      incompleteNodeIds: [],
      shotCount: 1,
      shotQa: { S001: true },
      resolutionPreset: '1080x1920',
      finalArtifactId: 'artifact-final',
    })

    const response = await GET(
      new Request('http://localhost/api/render/export?projectId=project-1')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      artifactUrl: '/api/artifacts/artifact-final?projectId=project-1',
    })
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/render/export', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
