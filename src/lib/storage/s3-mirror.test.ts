import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { LocalFsStorage } from './local-fs'
import type { PresignGetOverrides, RemoteObjectStore } from './remote-store'
import { S3MirrorStorage } from './s3-mirror'

/** 内存版远端对象存储：记录调用次数，供断言写穿/回填行为。 */
class FakeRemoteStore implements RemoteObjectStore {
  readonly objects = new Map<string, Buffer>()
  putCalls = 0
  getCalls = 0

  async putObject(key: string, data: Buffer): Promise<void> {
    this.putCalls += 1
    this.objects.set(key, Buffer.from(data))
  }

  async getObject(key: string): Promise<Buffer | null> {
    this.getCalls += 1
    const found = this.objects.get(key)
    return found ? Buffer.from(found) : null
  }

  async hasObject(key: string): Promise<boolean> {
    return this.objects.has(key)
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async presignGetUrl(
    key: string,
    ttlSeconds: number,
    response?: PresignGetOverrides
  ): Promise<string> {
    const disposition = response?.contentDisposition ?? ''
    return `https://fake-remote.example/${key}?ttl=${ttlSeconds}`
      + `&rct=${response?.contentType ?? ''}&rcd=${disposition}`
  }
}

describe('S3MirrorStorage', () => {
  const roots: string[] = []
  let local: LocalFsStorage
  let remote: FakeRemoteStore
  let mirror: S3MirrorStorage

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'cvc-mirror-'))
    roots.push(root)
    local = new LocalFsStorage(root)
    remote = new FakeRemoteStore()
    mirror = new S3MirrorStorage(local, remote)
  })

  afterAll(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('put 同时写本地与远端，远端失败时 put 必须失败', async () => {
    await mirror.put('a/video.mp4', Buffer.from('bytes'))
    expect(await local.exists('a/video.mp4')).toBe(true)
    expect(remote.objects.has('a/video.mp4')).toBe(true)

    remote.putObject = async () => {
      throw new Error('remote down')
    }
    await expect(mirror.put('b.bin', Buffer.from('x'))).rejects.toThrow()
  })

  it('get 本地命中时不访问远端', async () => {
    await mirror.put('hit.txt', 'local 内容')
    remote.getCalls = 0
    const buffer = await mirror.get('hit.txt')
    expect(buffer.toString('utf8')).toBe('local 内容')
    expect(remote.getCalls).toBe(0)
  })

  it('get 本地缺失时从远端回填本地（服务器重建场景）', async () => {
    remote.objects.set('old/artifact.mp4', Buffer.from('remote bytes'))
    const buffer = await mirror.get('old/artifact.mp4')
    expect(buffer.toString('utf8')).toBe('remote bytes')
    expect(await local.exists('old/artifact.mp4')).toBe(true)
  })

  it('get 两端都缺失时抛错', async () => {
    await expect(mirror.get('missing.bin')).rejects.toThrow()
  })

  it('ensureLocal 回填后返回本地绝对路径，供 ffmpeg/Chromium 使用', async () => {
    remote.objects.set('shots/1.mp4', Buffer.from('mp4'))
    const absolute = await mirror.ensureLocal('shots/1.mp4')
    expect(absolute).toBe(local.localPath('shots/1.mp4'))
    expect(await local.exists('shots/1.mp4')).toBe(true)

    await expect(mirror.ensureLocal('nowhere.mp4')).rejects.toThrow()
  })

  it('exists 任一端存在即为 true', async () => {
    remote.objects.set('remote-only.txt', Buffer.from('r'))
    expect(await mirror.exists('remote-only.txt')).toBe(true)
    await mirror.put('both.txt', 'x')
    expect(await mirror.exists('both.txt')).toBe(true)
    expect(await mirror.exists('neither.txt')).toBe(false)
  })

  it('delete 同时删除本地与远端', async () => {
    await mirror.put('gone.txt', 'x')
    await mirror.delete('gone.txt')
    expect(await local.exists('gone.txt')).toBe(false)
    expect(remote.objects.has('gone.txt')).toBe(false)
  })

  it('localPath 与临时目录族透传本地实现', async () => {
    expect(mirror.localPath('k.mp4')).toBe(local.localPath('k.mp4'))
    const workDirectory = await mirror.tempDir('cvc-mirror-unit-')
    try {
      expect(path.isAbsolute(workDirectory)).toBe(true)
    } finally {
      await mirror.removeTempDir(workDirectory)
    }
  })

  it('presignDownloadUrl 透传远端并携带 TTL 与响应头覆盖', async () => {
    const url = await mirror.presignDownloadUrl('a.mp4', 300, {
      contentType: 'video/mp4',
      contentDisposition: 'attachment; filename="a.mp4"',
    })
    expect(url).toBe(
      'https://fake-remote.example/a.mp4?ttl=300'
      + '&rct=video/mp4&rcd=attachment; filename="a.mp4"'
    )
  })
})
