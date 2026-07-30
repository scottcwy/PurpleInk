import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  getArtifactDescriptor: vi.fn(),
  readArtifact: vi.fn(),
  artifactContentType: vi.fn(),
  getProjectExecutionSnapshot: vi.fn(),
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
vi.mock('@/features/artifacts', () => mocks)
vi.mock('@/features/projects', () => ({
  getProjectExecutionSnapshot: mocks.getProjectExecutionSnapshot,
}))

describe('GET /api/artifacts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readArtifact.mockResolvedValue({
      descriptor: {
        id: 'a-1',
        kind: 'render-mp4',
        contentHash: 'a'.repeat(64),
      },
      bytes: Buffer.from('video'),
    })
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'a-1',
      kind: 'render-mp4',
      contentHash: 'a'.repeat(64),
    })
    mocks.artifactContentType.mockReturnValue('video/mp4')
  })

  it('serves only the artifact resolved inside the requested project', async () => {
    const response = await GET(
      new Request('http://localhost/api/artifacts/a-1?projectId=p-1'),
      { params: Promise.resolve({ id: 'a-1' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(mocks.readArtifact).toHaveBeenCalledWith('p-1', 'a-1')
  })

  it('does not expose a blocked or rejected website video as a formal download', async () => {
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'website-artifact',
      kind: 'website-video-mp4',
      contentHash: 'a'.repeat(64),
    })
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      state: 'blocked',
      delivery: {
        artifactId: 'website-artifact',
        lifecycle: 'rejected',
      },
    })

    const response = await GET(
      new Request(
        'http://localhost/api/artifacts/website-artifact?projectId=p-1',
      ),
      { params: Promise.resolve({ id: 'website-artifact' }) },
    )

    expect(response.status).toBe(404)
    expect(mocks.readArtifact).not.toHaveBeenCalled()
  })

  it('serves only the current succeeded approved website delivery', async () => {
    const bytes = Buffer.from('verified-video')
    const { createHash } = await import('node:crypto')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'website-artifact',
      kind: 'website-video-mp4',
      contentHash,
    })
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      state: 'succeeded',
      delivery: {
        artifactId: 'website-artifact',
        lifecycle: 'approved',
        downloadUrl:
          '/api/artifacts/website-artifact?projectId=p-1',
      },
    })
    mocks.readArtifact.mockResolvedValue({
      descriptor: {
        id: 'website-artifact',
        kind: 'website-video-mp4',
        contentHash,
      },
      bytes,
    })

    const response = await GET(
      new Request(
        'http://localhost/api/artifacts/website-artifact?projectId=p-1',
      ),
      { params: Promise.resolve({ id: 'website-artifact' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('x-content-sha256')).toBe(contentHash)
  })

  it('fails closed when website video bytes no longer match the registered hash', async () => {
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'website-artifact',
      kind: 'website-video-mp4',
      contentHash: 'a'.repeat(64),
    })
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      state: 'succeeded',
      delivery: {
        artifactId: 'website-artifact',
        lifecycle: 'approved',
        downloadUrl:
          '/api/artifacts/website-artifact?projectId=p-1',
      },
    })
    mocks.readArtifact.mockResolvedValue({
      descriptor: {
        id: 'website-artifact',
        kind: 'website-video-mp4',
        contentHash: 'a'.repeat(64),
      },
      bytes: Buffer.from('corrupt-video'),
    })

    const response = await GET(
      new Request(
        'http://localhost/api/artifacts/website-artifact?projectId=p-1',
      ),
      { params: Promise.resolve({ id: 'website-artifact' }) },
    )

    expect(response.status).toBe(404)
  })
})
