import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => {
  class QuotaExhaustedError extends Error {
    readonly code = 'QUOTA_EXHAUSTED'
    readonly resetAt = '2026-08-01T00:00:00.000Z'
    readonly billingUrl = '/products/billing'
  }
  class ProjectWorkflowStartError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly statusCode: number,
    ) {
      super(message)
    }
  }
  return {
    QuotaExhaustedError,
    ProjectWorkflowStartError,
    initQueue: vi.fn(),
    startProjectWorkflow: vi.fn(),
    classifyWorkflowError: vi.fn(),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: () => Promise<Response>) => handler(),
}))
vi.mock('@/features/billing', () => ({
  QuotaExhaustedError: mocks.QuotaExhaustedError,
}))
vi.mock('@/features/canvas', () => ({
  classifyWorkflowError: mocks.classifyWorkflowError,
}))
vi.mock('@/features/projects', () => ({
  ProjectWorkflowStartError: mocks.ProjectWorkflowStartError,
  startProjectWorkflow: mocks.startProjectWorkflow,
}))
vi.mock('@/lib/queue/init', () => ({ initQueue: mocks.initQueue }))

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'

describe('POST /api/projects/[id]/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initQueue.mockResolvedValue(undefined)
    mocks.startProjectWorkflow.mockResolvedValue({
      kind: 'audio',
      status: 'started',
      entryNodeId: 'entry-1',
      jobId: 'attempt-1',
      attemptStatus: 'queued',
      reused: false,
      enqueuedNodeIds: ['entry-1'],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    })
    mocks.classifyWorkflowError.mockReturnValue({
      code: 'QUEUE_FAILED',
      message: '工作流暂时无法启动',
    })
  })

  it('initializes the queue and dispatches from the persisted workflow kind', async () => {
    const response = await POST(new Request('http://localhost'), context(PROJECT_ID))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      kind: 'audio',
      jobId: 'attempt-1',
      attemptStatus: 'queued',
      reused: false,
    })
    expect(mocks.initQueue).toHaveBeenCalledOnce()
    expect(mocks.startProjectWorkflow).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('rejects an invalid path before touching billing or queue state', async () => {
    const response = await POST(new Request('http://localhost'), context('../bad'))
    expect(response.status).toBe(400)
    expect(mocks.initQueue).not.toHaveBeenCalled()
  })

  it('preserves the shared quota response contract', async () => {
    mocks.startProjectWorkflow.mockRejectedValue(new mocks.QuotaExhaustedError())
    const response = await POST(new Request('http://localhost'), context(PROJECT_ID))
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'QUOTA_EXHAUSTED',
      billingUrl: '/products/billing',
    })
  })

  it('returns declared project errors without exposing arbitrary failures', async () => {
    mocks.startProjectWorkflow.mockRejectedValue(
      new mocks.ProjectWorkflowStartError(
        'PROJECT_WORKFLOW_NOT_FOUND',
        '项目或项目来源不存在',
        404,
      ),
    )
    const missing = await POST(new Request('http://localhost'), context(PROJECT_ID))
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      code: 'PROJECT_WORKFLOW_NOT_FOUND',
    })

    mocks.startProjectWorkflow.mockRejectedValue(
      new Error('postgres password and provider response'),
    )
    const hidden = await POST(new Request('http://localhost'), context(PROJECT_ID))
    expect(hidden.status).toBe(409)
    await expect(hidden.json()).resolves.toEqual({
      ok: false,
      code: 'QUEUE_FAILED',
      error: '工作流暂时无法启动',
    })
  })
})

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}
