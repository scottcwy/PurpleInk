import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  getJobSnapshot: vi.fn(),
  getLatestArtifact: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/queue', () => ({ getJobSnapshot: mocks.getJobSnapshot }))
vi.mock('@/features/artifacts', () => ({ getLatestArtifact: mocks.getLatestArtifact }))

describe('GET /api/jobs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getJobSnapshot.mockReturnValue({
      id: 'job-1',
      projectId: 'project-1',
      nodeId: 'node-1',
      kind: 'render-shot',
      status: 'done',
      attempts: 1,
      error: null,
    })
    mocks.getLatestArtifact.mockReturnValue({ id: 'artifact-1' })
  })

  it('returns an opaque artifact URL for a completed render job', async () => {
    const response = await GET(
      new Request('http://localhost/api/jobs/job-1?projectId=project-1'),
      { params: Promise.resolve({ id: 'job-1' }) }
    )

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      artifactUrl: '/api/artifacts/artifact-1?projectId=project-1',
    })
  })
})
