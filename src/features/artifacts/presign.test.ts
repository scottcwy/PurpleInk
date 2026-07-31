import { describe, expect, it } from 'vitest'
import { presignArtifactDownload, supportsPresignedDownload } from './presign'

/** 记录透传参数的最小假实现，对应 S3MirrorStorage.presignDownloadUrl 的形状。 */
function fakePresignStorage() {
  const calls: Array<{
    key: string
    ttlSeconds: number
    response?: { contentType?: string; contentDisposition?: string }
  }> = []
  return {
    calls,
    async presignDownloadUrl(
      key: string,
      ttlSeconds: number,
      response?: { contentType?: string; contentDisposition?: string }
    ): Promise<string> {
      calls.push({ key, ttlSeconds, response })
      return `https://r2.example/${key}?signed=1`
    },
  }
}

describe('supportsPresignedDownload', () => {
  it('只认得具备 presignDownloadUrl 方法的适配器', () => {
    expect(supportsPresignedDownload(fakePresignStorage())).toBe(true)
    // local 模式的 LocalFsStorage 没有该方法，必须判否。
    expect(supportsPresignedDownload({ get: async () => Buffer.alloc(0) })).toBe(false)
    expect(supportsPresignedDownload(null)).toBe(false)
    expect(supportsPresignedDownload('storage')).toBe(false)
  })
})

describe('presignArtifactDownload', () => {
  const input = {
    storageKey: 'p-1/final.mp4',
    kind: 'final-mp4',
    contentHash: '8d21f3a4b5c6' + 'd'.repeat(52),
    attachment: false,
    ttlSeconds: 300,
  }

  it('适配器不具备预签名能力时返回 null（local 模式走原字节流路径）', async () => {
    await expect(
      presignArtifactDownload({ get: async () => Buffer.alloc(0) }, input)
    ).resolves.toBeNull()
  })

  it('透传 storageKey 与 TTL，并强制覆盖 response content-type', async () => {
    // put 上传时未写对象 content-type，远端默认回 octet-stream；
    // 不覆盖的话 <video> 内联播放会被浏览器拒绝。
    const storage = fakePresignStorage()
    const url = await presignArtifactDownload(storage, input)
    expect(url).toBe('https://r2.example/p-1/final.mp4?signed=1')
    expect(storage.calls).toEqual([
      {
        key: 'p-1/final.mp4',
        ttlSeconds: 300,
        response: { contentType: 'video/mp4' },
      },
    ])
  })

  it('attachment 时附带与字节流路径同源的下载文件名', async () => {
    const storage = fakePresignStorage()
    await presignArtifactDownload(storage, { ...input, attachment: true })
    expect(storage.calls[0]?.response).toEqual({
      contentType: 'video/mp4',
      contentDisposition: 'attachment; filename="final-mp4-8d21f3a4b5c6.mp4"',
    })
  })

  it('内联（非 attachment）不写 content-disposition', async () => {
    const storage = fakePresignStorage()
    await presignArtifactDownload(storage, {
      ...input,
      kind: 'narration-audio:U001',
      contentHash: null,
    })
    expect(storage.calls[0]?.response).toEqual({ contentType: 'audio/mpeg' })
  })
})
