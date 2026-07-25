import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  ensureShotQaChecked: vi.fn(),
  getExportReadiness: vi.fn(),
  enqueueProjectExport: vi.fn(),
  initQueue: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/features/render/export-service', () => ({
  ensureShotQaChecked: mocks.ensureShotQaChecked,
  getExportReadiness: mocks.getExportReadiness,
}))
vi.mock('@/features/render/export-queue-handler', () => ({
  enqueueProjectExport: mocks.enqueueProjectExport,
}))
vi.mock('@/lib/queue/init', () => ({ initQueue: mocks.initQueue }))

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    incompleteNodeIds: [],
    shotCount: 1,
    shotQa: { S001: true },
    resolutionPreset: '1080x1920',
    finalArtifactId: null,
    ...overrides,
  }
}

describe('POST /api/render/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enqueueProjectExport.mockResolvedValue('job-export-1')
  })

  it('returns 400 for invalid input', async () => {
    const response = await POST(request({ projectId: '' }))
    expect(response.status).toBe(400)
    expect(mocks.enqueueProjectExport).not.toHaveBeenCalled()
  })

  it('returns every incomplete node with status 409 and does not enqueue', async () => {
    mocks.getExportReadiness.mockResolvedValue(
      readiness({ ready: false, incompleteNodeIds: ['node-1', 'node-2'] })
    )

    const response = await POST(request({ projectId: 'project-1' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      incompleteNodeIds: ['node-1', 'node-2'],
    })
    expect(mocks.enqueueProjectExport).not.toHaveBeenCalled()
  })

  it('enqueues a project-level export job and returns its id', async () => {
    mocks.getExportReadiness.mockResolvedValue(readiness())

    const response = await POST(request({ projectId: 'project-1' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      jobId: 'job-export-1',
    })
    expect(mocks.enqueueProjectExport).toHaveBeenCalledWith({
      projectId: 'project-1',
    })
  })

  it('maps an enqueue failure to 409 without leaking the raw cause', async () => {
    mocks.getExportReadiness.mockResolvedValue(readiness())
    mocks.enqueueProjectExport.mockRejectedValueOnce(new Error('队列不可用'))

    const response = await POST(request({ projectId: 'project-1' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '队列不可用',
    })
  })
})

describe('GET /api/render/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a controlled URL for the latest final artifact', async () => {
    mocks.getExportReadiness.mockReturnValue(
      readiness({ finalArtifactId: 'artifact-final' })
    )

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
