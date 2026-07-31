import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE, POST } from './route'

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
  class ProjectExecutionStopError extends Error {
    readonly code = 'PROJECT_NOT_FOUND'
    readonly statusCode = 404

    constructor(message = '项目不存在') {
      super(message)
    }
  }
  return {
    QuotaExhaustedError,
    ProjectExecutionStopError,
    ProjectWorkflowStartError,
    initQueue: vi.fn(),
    startProjectWorkflow: vi.fn(),
    stopProjectExecution: vi.fn(),
    getProjectExecutionSnapshot: vi.fn(),
    recoverWebsiteDelivery: vi.fn(),
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
  ProjectExecutionStopError: mocks.ProjectExecutionStopError,
  ProjectWorkflowStartError: mocks.ProjectWorkflowStartError,
  startProjectWorkflow: mocks.startProjectWorkflow,
  stopProjectExecution: mocks.stopProjectExecution,
  getProjectExecutionSnapshot: mocks.getProjectExecutionSnapshot,
  recoverWebsiteDelivery: mocks.recoverWebsiteDelivery,
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
    mocks.stopProjectExecution.mockResolvedValue({
      autopilot: false,
      status: 'stopping',
      cancelledAttempts: 3,
      cancelledRuns: 2,
      cancelledTickets: 1,
      cancelledLeases: 2,
      remainingRunning: 1,
    })
    mocks.getProjectExecutionSnapshot.mockResolvedValue(execution())
    mocks.recoverWebsiteDelivery.mockResolvedValue(false)
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
      execution: { state: 'queued', workflowKind: 'audio' },
    })
    expect(mocks.initQueue).toHaveBeenCalledOnce()
    expect(mocks.startProjectWorkflow).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('returns an already delivered website project without enqueuing it again', async () => {
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      ...execution(),
      workflowKind: 'website',
      state: 'succeeded',
      active: false,
      canStart: false,
      canStop: false,
    })

    const response = await POST(new Request('http://localhost'), context(PROJECT_ID))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      kind: 'website',
      status: 'complete',
      execution: { workflowKind: 'website', state: 'succeeded' },
    })
    expect(mocks.initQueue).not.toHaveBeenCalled()
    expect(mocks.startProjectWorkflow).not.toHaveBeenCalled()
  })

  it('repairs a verified website draft without invoking the engine again', async () => {
    mocks.getProjectExecutionSnapshot
      .mockResolvedValueOnce({
        ...execution(),
        workflowKind: 'website',
        state: 'blocked',
        active: false,
        canStart: true,
        canStop: false,
      })
      .mockResolvedValueOnce({
        ...execution(),
        workflowKind: 'website',
        state: 'succeeded',
        active: false,
        canStart: false,
        canStop: false,
      })
    mocks.recoverWebsiteDelivery.mockResolvedValue(true)

    const response = await POST(new Request('http://localhost'), context(PROJECT_ID))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      kind: 'website',
      status: 'complete',
      execution: { workflowKind: 'website', state: 'succeeded' },
    })
    expect(mocks.recoverWebsiteDelivery).toHaveBeenCalledWith(PROJECT_ID)
    expect(mocks.initQueue).not.toHaveBeenCalled()
    expect(mocks.startProjectWorkflow).not.toHaveBeenCalled()
  })

  it('distinguishes a reused website attempt from a newly queued attempt', async () => {
    mocks.getProjectExecutionSnapshot
      .mockResolvedValueOnce({
        ...execution(),
        workflowKind: 'website',
        state: 'idle',
        active: false,
        canStart: true,
        canStop: false,
      })
      .mockResolvedValueOnce({
        ...execution(),
        workflowKind: 'website',
        state: 'queued',
      })
    mocks.startProjectWorkflow.mockResolvedValue({
      kind: 'website',
      status: 'started',
      entryNodeId: 'entry-1',
      jobId: 'attempt-1',
      attemptStatus: 'queued',
      reused: true,
      enqueuedNodeIds: ['entry-1'],
    })

    const response = await POST(new Request('http://localhost'), context(PROJECT_ID))

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      kind: 'website',
      status: 'reused',
      execution: { state: 'queued' },
    })
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

  it('stops every workflow kind through the unified project route', async () => {
    const response = await DELETE(
      new Request('http://localhost', { method: 'DELETE' }),
      context(PROJECT_ID),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      autopilot: false,
      status: 'stopping',
      cancelledAttempts: 3,
      cancelledRuns: 2,
      cancelledTickets: 1,
      cancelledLeases: 2,
      remainingRunning: 1,
      execution: execution(),
    })
    expect(mocks.stopProjectExecution).toHaveBeenCalledWith(PROJECT_ID)
    expect(mocks.initQueue).not.toHaveBeenCalled()
  })

  it('validates stop ids and preserves a safe missing-project response', async () => {
    const invalid = await DELETE(
      new Request('http://localhost', { method: 'DELETE' }),
      context('../bad'),
    )
    expect(invalid.status).toBe(400)
    expect(mocks.stopProjectExecution).not.toHaveBeenCalled()

    mocks.stopProjectExecution.mockRejectedValue(
      new mocks.ProjectExecutionStopError('项目不存在'),
    )
    const missing = await DELETE(
      new Request('http://localhost', { method: 'DELETE' }),
      context(PROJECT_ID),
    )
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toMatchObject({
      ok: false,
      code: 'PROJECT_NOT_FOUND',
    })
  })
})

function context(id: string) {
  return { params: Promise.resolve({ id }) }
}

function execution() {
  return {
    workflowKind: 'audio',
    state: 'queued',
    active: true,
    canStart: false,
    canStop: true,
    attempt: {
      id: 'attempt-1',
      status: 'queued',
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
    currentStage: null,
    stages: [],
    delivery: null,
    revision: 'a'.repeat(64),
  }
}
