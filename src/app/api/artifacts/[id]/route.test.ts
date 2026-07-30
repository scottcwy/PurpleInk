import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getArtifactDescriptor: vi.fn(),
  getProjectExecutionSnapshot: vi.fn(),
  readArtifact: vi.fn(),
}))

vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: () => Promise<Response>) => handler(),
}))
// 只替换会碰数据库与存储的 readArtifact；content-type 与文件名推导都是纯函数，
// 用真实实现，这样路由测试锁到的头就是生产环境真会发出的头。
vi.mock('@/features/artifacts', async () => {
  const [download, contentType] = await Promise.all([
    import('@/features/artifacts/download'),
    import('@/features/artifacts/content-type'),
  ])
  return {
    getArtifactDescriptor: mocks.getArtifactDescriptor,
    readArtifact: mocks.readArtifact,
    artifactContentType: contentType.artifactContentType,
    artifactDownloadFilename: download.artifactDownloadFilename,
    attachmentDisposition: download.attachmentDisposition,
    wantsAttachment: download.wantsAttachment,
  }
})
vi.mock('@/features/projects', () => ({
  getProjectExecutionSnapshot: mocks.getProjectExecutionSnapshot,
}))

const { GET } = await import('./route')

const HASH = '8d21f3a4b5c6'.padEnd(64, '0')

describe('GET /api/artifacts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'artifact-1',
      projectId: 'project-1',
      nodeId: null,
      kind: 'final-mp4',
      contentHash: HASH,
    })
    mocks.readArtifact.mockResolvedValue({
      descriptor: {
        id: 'artifact-1',
        projectId: 'project-1',
        nodeId: null,
        kind: 'final-mp4',
        contentHash: HASH,
      },
      bytes: Buffer.from('mp4-bytes'),
    })
  })

  it('serves the artifact inline by default', async () => {
    const response = await GET(
      new Request('https://app.test/api/artifacts/artifact-1?projectId=project-1'),
      { params: Promise.resolve({ id: 'artifact-1' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    // 内联是默认：画布检查器与成片预览都靠它播放，不能被下载改造顺手破坏。
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(mocks.readArtifact).toHaveBeenCalledWith('project-1', 'artifact-1')
  })

  it('forces a download when the flag is set, with a hash-traceable filename', async () => {
    const response = await GET(
      new Request(
        'https://app.test/api/artifacts/artifact-1?projectId=project-1&download=1'
      ),
      { params: Promise.resolve({ id: 'artifact-1' }) }
    )

    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="final-mp4-8d21f3a4b5c6.mp4"'
    )
    expect(response.headers.get('content-type')).toBe('video/mp4')
  })

  it('rejects a request without projectId and never reads storage', async () => {
    const response = await GET(
      new Request('https://app.test/api/artifacts/artifact-1'),
      { params: Promise.resolve({ id: 'artifact-1' }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.readArtifact).not.toHaveBeenCalled()
  })

  it('maps an ownership failure to 404 without leaking internals', async () => {
    mocks.getArtifactDescriptor.mockResolvedValue(null)

    const response = await GET(
      new Request('https://app.test/api/artifacts/other?projectId=project-1&download=1'),
      { params: Promise.resolve({ id: 'other' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('产物不存在')
    expect(response.headers.get('content-disposition')).toBeNull()
  })

  it('does not expose a blocked or rejected website video', async () => {
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'website-artifact',
      projectId: 'project-1',
      nodeId: null,
      kind: 'website-video-mp4',
      contentHash: HASH,
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
        'https://app.test/api/artifacts/website-artifact?projectId=project-1&download=1'
      ),
      { params: Promise.resolve({ id: 'website-artifact' }) }
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
      projectId: 'project-1',
      nodeId: null,
      kind: 'website-video-mp4',
      contentHash,
    })
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      state: 'succeeded',
      delivery: {
        artifactId: 'website-artifact',
        lifecycle: 'approved',
        downloadUrl:
          '/api/artifacts/website-artifact?projectId=project-1',
      },
    })
    mocks.readArtifact.mockResolvedValue({
      descriptor: {
        id: 'website-artifact',
        projectId: 'project-1',
        nodeId: null,
        kind: 'website-video-mp4',
        contentHash,
      },
      bytes,
    })

    const response = await GET(
      new Request(
        'https://app.test/api/artifacts/website-artifact?projectId=project-1&download=1'
      ),
      { params: Promise.resolve({ id: 'website-artifact' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('x-content-sha256')).toBe(contentHash)
    expect(response.headers.get('content-disposition')).toContain('attachment')
  })

  it('fails closed when website video bytes no longer match the registered hash', async () => {
    mocks.getArtifactDescriptor.mockResolvedValue({
      id: 'website-artifact',
      projectId: 'project-1',
      nodeId: null,
      kind: 'website-video-mp4',
      contentHash: 'a'.repeat(64),
    })
    mocks.getProjectExecutionSnapshot.mockResolvedValue({
      state: 'succeeded',
      delivery: {
        artifactId: 'website-artifact',
        lifecycle: 'approved',
        downloadUrl:
          '/api/artifacts/website-artifact?projectId=project-1',
      },
    })
    mocks.readArtifact.mockResolvedValue({
      descriptor: {
        id: 'website-artifact',
        projectId: 'project-1',
        nodeId: null,
        kind: 'website-video-mp4',
        contentHash: 'a'.repeat(64),
      },
      bytes: Buffer.from('corrupt-video'),
    })

    const response = await GET(
      new Request(
        'https://app.test/api/artifacts/website-artifact?projectId=project-1'
      ),
      { params: Promise.resolve({ id: 'website-artifact' }) }
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('x-content-sha256')).toBeNull()
  })
})
