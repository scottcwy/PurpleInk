import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  ensureShotQaChecked: vi.fn(),
  getExportReadiness: vi.fn(),
  requestExportFinalization: vi.fn(),
  initQueue: vi.fn(),
  assertProjectWorkflowSupported: vi.fn(),
}))

class UnsupportedProjectWorkflowError extends Error {}

vi.mock('server-only', () => ({}))
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
vi.mock('@/features/render/export-service', () => ({
  ensureShotQaChecked: mocks.ensureShotQaChecked,
}))
vi.mock('@/features/render/export-readiness', () => ({
  getExportReadiness: mocks.getExportReadiness,
}))
vi.mock('@/features/director/export-finalization', () => ({
  requestExportFinalization: mocks.requestExportFinalization,
}))
vi.mock('@/lib/queue/init', () => ({ initQueue: mocks.initQueue }))
vi.mock('@/features/projects/project-compatibility', () => ({
  assertProjectWorkflowSupported: mocks.assertProjectWorkflowSupported,
}))

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    incompleteNodeIds: [],
    shotCount: 1,
    shotQa: { S001: true },
    resolutionPreset: '1920x1080',
    finalArtifactId: null,
    confirmationFingerprint: null,
    ...overrides,
  }
}

describe('POST /api/render/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requestExportFinalization.mockResolvedValue({
      status: 'queued',
      nodeId: 'export-node',
      jobId: 'job-export-1',
      mode: 'complete',
    })
  })

  it('returns 400 for invalid input', async () => {
    const response = await POST(request({ projectId: '' }))
    expect(response.status).toBe(400)
    expect(mocks.requestExportFinalization).not.toHaveBeenCalled()
  })

  it('returns the safe not-ready details with status 409', async () => {
    const blockingIssues = [
      { laneKey: 'S001', kind: 'narration', code: 'artifact-missing' },
    ]
    const error = new Error('项目尚未满足终片导出条件')
    error.name = 'ExportFinalizationNotReadyError'
    Object.assign(error, {
      safeDetails: { incompleteNodeIds: ['node-1', 'node-2'], blockingIssues },
    })
    mocks.requestExportFinalization.mockRejectedValue(error)

    const response = await POST(request({ projectId: 'project-1' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: 'EXPORT_NOT_READY',
      error: '项目尚未满足终片导出条件',
      incompleteNodeIds: ['node-1', 'node-2'],
      blockingIssues,
    })
  })

  it('rejects an unsupported workflow before queue initialization', async () => {
    mocks.assertProjectWorkflowSupported.mockRejectedValueOnce(
      new UnsupportedProjectWorkflowError('旧版项目暂不可用'),
    )

    const response = await POST(request({ projectId: 'old-project' }))

    expect(response.status).toBe(409)
    expect(mocks.initQueue).not.toHaveBeenCalled()
    expect(mocks.requestExportFinalization).not.toHaveBeenCalled()
  })

  it('queues a normal export through the single coordinator', async () => {
    const response = await POST(request({ projectId: 'project-1' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      jobId: 'job-export-1',
    })
    expect(mocks.requestExportFinalization).toHaveBeenCalledWith({
      projectId: 'project-1',
      trigger: 'manual-node',
    })
  })

  it('requires and forwards the current fingerprint for degraded confirmation', async () => {
    const missing = await POST(request({ projectId: 'project-1', degraded: true }))
    expect(missing.status).toBe(400)

    const response = await POST(request({
      projectId: 'project-1',
      degraded: true,
      confirmationFingerprint: 'sha256:current',
    }))

    expect(response.status).toBe(200)
    expect(mocks.requestExportFinalization).toHaveBeenCalledWith({
      projectId: 'project-1',
      trigger: 'confirmed-degraded',
      confirmationFingerprint: 'sha256:current',
    })
  })

  it('returns 409 when the confirmed degraded scope is stale', async () => {
    const error = new Error('导出范围已变化，请刷新后重新确认降级交付')
    error.name = 'StaleDegradedConfirmationError'
    mocks.requestExportFinalization.mockRejectedValueOnce(error)

    const response = await POST(request({
      projectId: 'project-1',
      degraded: true,
      confirmationFingerprint: 'sha256:stale',
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'DEGRADED_CONFIRMATION_STALE',
    })
  })
})

describe('GET /api/render/export', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a controlled URL and the current confirmation fingerprint', async () => {
    mocks.getExportReadiness.mockReturnValue(
      readiness({
        finalArtifactId: 'artifact-final',
        confirmationFingerprint: 'sha256:current',
      }),
    )

    const response = await GET(
      new Request('http://localhost/api/render/export?projectId=project-1'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      artifactUrl: '/api/artifacts/artifact-final?projectId=project-1',
      confirmationFingerprint: 'sha256:current',
    })
  })
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/render/export', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
