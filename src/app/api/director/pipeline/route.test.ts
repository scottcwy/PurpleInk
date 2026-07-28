import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuotaExhaustedError } from '@/features/billing'
import { DELETE, POST } from './route'

const mocks = vi.hoisted(() => ({
  startProjectPipeline: vi.fn(),
  stopProjectPipeline: vi.fn(),
  initQueue: vi.fn(),
}))

vi.mock('server-only', () => ({}))
// 会话层单独有 pg 测试覆盖；这里只验路由业务分支，直接以假会话放行。
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: unknown) => Promise<Response>) =>
    handler({
      userId: 'user-1',
      workspaceId: 'ws-1',
      email: 'user@example.com',
      name: '测试用户',
      workspaceName: '测试工作区',
      sessionId: 'session-1',
    }),
}))
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
      status: 'started',
      enqueuedNodeIds: ['ingest'],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
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
      status: 'started',
      enqueuedNodeIds: ['ingest'],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [],
    })
    expect(mocks.initQueue).toHaveBeenCalledOnce()
    expect(mocks.startProjectPipeline).toHaveBeenCalledWith('project-1')
  })

  it('returns the public 402 quota contract', async () => {
    mocks.startProjectPipeline.mockRejectedValue(
      new QuotaExhaustedError('2026-08-27T00:00:00.000Z'),
    )

    const response = await POST(request('POST', { projectId: 'project-1' }))

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      code: 'quota_exhausted',
      resetAt: '2026-08-27T00:00:00.000Z',
      billingUrl: '/products/billing',
    })
  })

  it('returns blocked instead of claiming a zero-enqueue start', async () => {
    mocks.startProjectPipeline.mockResolvedValue({
      autopilot: true,
      status: 'blocked',
      enqueuedNodeIds: [],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [
        {
          nodeId: 'codegen-s002',
          code: 'CONFIGURATION_BLOCKED',
          message: '请先检查模型配置',
        },
      ],
    })
    const response = await POST(request('POST', { projectId: 'project-1' }))
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'blocked',
      enqueuedNodeIds: [],
    })
  })

  it('returns a conflict without leaking an internal stack', async () => {
    mocks.startProjectPipeline.mockRejectedValue(new Error('入口节点当前不可入队'))

    const response = await POST(request('POST', { projectId: 'project-1' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '作业暂时无法进入执行队列，请稍后重试。',
      code: 'QUEUE_FAILED',
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
