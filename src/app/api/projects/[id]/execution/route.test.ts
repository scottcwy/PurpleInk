import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => {
  class ProjectExecutionSnapshotError extends Error {
    readonly code = 'PROJECT_NOT_FOUND'
    readonly statusCode = 404
  }
  return {
    getProjectExecutionSnapshot: vi.fn(),
    ProjectExecutionSnapshotError,
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: () => Promise<Response>) => handler(),
}))
vi.mock('@/features/projects', () => ({
  getProjectExecutionSnapshot: mocks.getProjectExecutionSnapshot,
  ProjectExecutionSnapshotError: mocks.ProjectExecutionSnapshotError,
}))

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'

describe('GET /api/projects/[id]/execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      workflowKind: 'website',
      state: 'running',
      active: true,
      canStart: false,
      canStop: true,
      attempt: null,
      currentStage: null,
      stages: [],
      delivery: null,
      revision: 'a'.repeat(64),
    })
  })

  it('returns the safe database snapshot', async () => {
    const response = await GET(new Request('http://localhost'), context(PROJECT_ID))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      execution: {
        workflowKind: 'website',
        state: 'running',
      },
    })
    expect(mocks.getProjectExecutionSnapshot).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('rejects invalid ids before querying the database', async () => {
    const response = await GET(new Request('http://localhost'), context('../bad'))
    expect(response.status).toBe(400)
    expect(mocks.getProjectExecutionSnapshot).not.toHaveBeenCalled()
  })
})

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}
