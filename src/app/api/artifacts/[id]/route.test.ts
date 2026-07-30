import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ readArtifact: vi.fn() }))

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
    readArtifact: mocks.readArtifact,
    artifactContentType: contentType.artifactContentType,
    artifactDownloadFilename: download.artifactDownloadFilename,
    attachmentDisposition: download.attachmentDisposition,
    wantsAttachment: download.wantsAttachment,
  }
})

const { GET } = await import('./route')

const HASH = '8d21f3a4b5c6'.padEnd(64, '0')

describe('GET /api/artifacts/[id]', () => {
  beforeEach(() => {
    mocks.readArtifact.mockReset()
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
    mocks.readArtifact.mockRejectedValue(new Error('产物不存在或不属于该项目'))

    const response = await GET(
      new Request('https://app.test/api/artifacts/other?projectId=project-1&download=1'),
      { params: Promise.resolve({ id: 'other' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('产物不存在')
    expect(response.headers.get('content-disposition')).toBeNull()
  })
})
