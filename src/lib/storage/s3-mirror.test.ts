import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalFsStorage } from './local-fs'
import type { RemoteObjectStore } from './remote-store'
import { S3MirrorStorage } from './s3-mirror'

vi.mock('server-only', () => ({}))

class FakeRemoteStore implements RemoteObjectStore {
  readonly objects = new Map<string, Buffer>()
  readonly metadata = new Map<string, Record<string, string>>()
  readonly putKeys: string[] = []
  readonly getKeys: string[] = []
  readonly hasKeys: string[] = []
  readonly metadataKeys: string[] = []
  readonly deleteKeys: string[] = []
  readonly presignCalls: Array<{
    key: string
    ttlSeconds: number
    response?: { contentType?: string; contentDisposition?: string }
  }> = []
  readonly operationOrder: string[] = []
  putError: Error | undefined
  deleteError: Error | undefined

  async putObject(
    key: string,
    data: Buffer,
    options?: { metadata?: Record<string, string> },
  ): Promise<void> {
    this.putKeys.push(key)
    if (this.putError) throw this.putError
    this.objects.set(key, Buffer.from(data))
    this.metadata.set(key, { ...(options?.metadata ?? {}) })
  }

  async getObject(key: string): Promise<Buffer | null> {
    this.getKeys.push(key)
    const found = this.objects.get(key)
    return found ? Buffer.from(found) : null
  }

  async hasObject(key: string): Promise<boolean> {
    this.hasKeys.push(key)
    return this.objects.has(key)
  }

  async getObjectMetadata(key: string): Promise<Record<string, string> | null> {
    this.metadataKeys.push(key)
    this.operationOrder.push(`head:${key}`)
    if (!this.objects.has(key)) return null
    return { ...(this.metadata.get(key) ?? {}) }
  }

  async deleteObject(key: string): Promise<void> {
    this.deleteKeys.push(key)
    if (this.deleteError) throw this.deleteError
    this.objects.delete(key)
  }

  async presignGetUrl(
    key: string,
    ttlSeconds: number,
    response?: { contentType?: string; contentDisposition?: string },
  ): Promise<string> {
    this.operationOrder.push(`sign:${key}`)
    this.presignCalls.push({ key, ttlSeconds, response })
    return `https://r2.example.test/${key}`
  }
}

class FailingLocalStorage extends LocalFsStorage {
  putError: Error | undefined
  deleteError: Error | undefined
  beforePut: (() => Promise<void>) | undefined

  override async put(
    key: string,
    data: Buffer | Uint8Array | string,
  ): Promise<string> {
    await this.beforePut?.()
    const storedKey = await super.put(key, data)
    if (this.putError) throw this.putError
    return storedKey
  }

  override async delete(key: string): Promise<void> {
    if (this.deleteError) throw this.deleteError
    await super.delete(key)
  }
}

describe('S3MirrorStorage', () => {
  const roots: string[] = []
  let local: FailingLocalStorage
  let remote: FakeRemoteStore
  let mirror: S3MirrorStorage

  beforeEach(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'purpleink-mirror-'))
    roots.push(root)
    local = new FailingLocalStorage(root)
    remote = new FakeRemoteStore()
    mirror = new S3MirrorStorage(local, remote)
  })

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it('uses one canonical key for the return value and both stores', async () => {
    const key = String.raw`nested\artifact.bin`

    await expect(mirror.put(key, 'bytes')).resolves.toBe('nested/artifact.bin')
    expect(remote.putKeys).toEqual(['nested/artifact.bin'])
    expect(await local.exists('nested/artifact.bin')).toBe(true)

    await local.delete('nested/artifact.bin')
    await expect(mirror.get(key)).resolves.toEqual(Buffer.from('bytes'))
    expect(remote.getKeys).toEqual(['nested/artifact.bin'])
    await local.delete('nested/artifact.bin')
    await expect(mirror.exists(key)).resolves.toBe(true)
    expect(remote.hasKeys).toEqual(['nested/artifact.bin'])
    await mirror.delete(key)
    expect(remote.deleteKeys).toEqual(['nested/artifact.bin'])
  })

  it('stores the exact uploaded-byte SHA-256 as remote object metadata', async () => {
    const bytes = Buffer.from('metadata bytes')
    const digest = createHash('sha256').update(bytes).digest('hex')

    await mirror.put('durable.bin', bytes)

    expect(remote.metadata.get('durable.bin')).toEqual({
      'content-sha256': digest,
    })
  })

  it.each([
    ['missing object', null],
    ['missing metadata', {}],
    ['mismatched metadata', { 'content-sha256': 'b'.repeat(64) }],
  ])('fails presigning before URL generation for %s', async (_name, metadata) => {
    remote.objects.set('durable.bin', Buffer.from('bytes'))
    if (metadata) remote.metadata.set('durable.bin', metadata)
    if (metadata === null) remote.objects.delete('durable.bin')

    await expect(mirror.presignDownloadUrl('durable.bin', 300, {
      expectedContentSha256: 'a'.repeat(64),
      response: { contentType: 'video/mp4' },
    })).rejects.toThrow()

    expect(remote.metadataKeys).toEqual(['durable.bin'])
    expect(remote.presignCalls).toEqual([])
  })

  it('heads protected bytes before signing with the same response overrides', async () => {
    const digest = 'a'.repeat(64)
    remote.objects.set('durable.bin', Buffer.from('bytes'))
    remote.metadata.set('durable.bin', { 'content-sha256': digest })
    const response = {
      contentType: 'video/mp4',
      contentDisposition: 'attachment; filename="final.mp4"',
    }

    await expect(mirror.presignDownloadUrl('durable.bin', 300, {
      expectedContentSha256: digest,
      response,
    })).resolves.toBe('https://r2.example.test/durable.bin')

    expect(remote.operationOrder).toEqual([
      'head:durable.bin',
      'sign:durable.bin',
    ])
    expect(remote.presignCalls).toEqual([{
      key: 'durable.bin',
      ttlSeconds: 300,
      response,
    }])
  })

  it('signs unprotected bytes without a metadata head', async () => {
    await expect(mirror.presignDownloadUrl('spec.json', 300, {
      response: { contentType: 'application/json' },
    })).resolves.toBe('https://r2.example.test/spec.json')

    expect(remote.operationOrder).toEqual(['sign:spec.json'])
  })

  it('rejects unsafe keys before either store is touched', async () => {
    const unsafeKeys = [
      '../outside.bin',
      String.raw`..\outside.bin`,
      '/tmp/absolute.bin',
      'C:/temp/absolute.bin',
      String.raw`C:\temp\absolute.bin`,
      String.raw`\\server\share\absolute.bin`,
    ]

    for (const key of unsafeKeys) {
      await expect(mirror.put(key, 'x')).rejects.toThrow(/root/)
      await expect(mirror.get(key)).rejects.toThrow(/root/)
      await expect(mirror.exists(key)).rejects.toThrow(/root/)
      await expect(mirror.delete(key)).rejects.toThrow(/root/)
    }
    expect(remote.putKeys).toEqual([])
    expect(remote.getKeys).toEqual([])
    expect(remote.hasKeys).toEqual([])
    expect(remote.deleteKeys).toEqual([])
  })

  it('does not expose a local copy when the durable remote write fails', async () => {
    remote.putError = new Error('remote endpoint sentinel')

    await expect(mirror.put('failed.bin', 'bytes')).rejects.toThrow()

    expect(await local.exists('failed.bin')).toBe(false)
    expect(remote.objects.has('failed.bin')).toBe(false)
  })

  it('rejects a local cache failure after remote success and later refills it', async () => {
    local.putError = new Error('local cache failed')

    await expect(mirror.put('durable.bin', 'bytes')).rejects.toThrow(
      'local cache failed',
    )
    expect(remote.objects.get('durable.bin')).toEqual(Buffer.from('bytes'))
    expect(await local.exists('durable.bin')).toBe(false)

    local.putError = undefined
    await expect(mirror.get('durable.bin')).resolves.toEqual(Buffer.from('bytes'))
    expect(await local.get('durable.bin')).toEqual(Buffer.from('bytes'))
  })

  it('preserves cache write and compensation failures together', async () => {
    local.putError = new Error('local write sentinel')
    local.deleteError = new Error('local delete sentinel')

    let thrown: unknown
    try {
      await mirror.put('durable.bin', 'bytes')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual([
      local.putError,
      local.deleteError,
    ])
    expect(remote.objects.get('durable.bin')).toEqual(Buffer.from('bytes'))
  })

  it('bypasses an uncleaned failed cache write until remote refill succeeds', async () => {
    local.putError = new Error('local write sentinel')
    local.deleteError = new Error('local delete sentinel')
    await expect(mirror.put('durable.bin', 'stale')).rejects.toBeInstanceOf(
      AggregateError,
    )
    expect(await local.get('durable.bin')).toEqual(Buffer.from('stale'))
    remote.objects.set('durable.bin', Buffer.from('fresh'))
    local.putError = undefined
    local.deleteError = undefined

    await expect(mirror.get('durable.bin')).resolves.toEqual(
      Buffer.from('fresh'),
    )

    expect(remote.getKeys).toEqual(['durable.bin'])
    expect(await local.get('durable.bin')).toEqual(Buffer.from('fresh'))
    expect(mirror.localPath('durable.bin')).toBe(local.localPath('durable.bin'))
  })

  it('fails localPath closed while a cache key is untrusted', async () => {
    local.putError = new Error('local write sentinel')
    local.deleteError = new Error('local delete sentinel')
    await expect(mirror.put('durable.bin', 'stale')).rejects.toBeInstanceOf(
      AggregateError,
    )

    expect(() => mirror.localPath('durable.bin')).toThrow(/untrusted/i)
  })

  it('revokes trust before rewriting an already trusted cache entry', async () => {
    await mirror.put('durable.bin', 'old')
    expect(mirror.localPath('durable.bin')).toBe(local.localPath('durable.bin'))
    let markWriteStarted!: () => void
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    let releaseWrite!: () => void
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    local.beforePut = async () => {
      markWriteStarted()
      await writeReleased
    }

    const rewrite = mirror.put('durable.bin', 'new')
    await writeStarted
    let trustAssertionFailure: unknown
    try {
      expect(() => mirror.localPath('durable.bin')).toThrow(/untrusted/i)
    } catch (error) {
      trustAssertionFailure = error
    } finally {
      releaseWrite()
    }

    await expect(rewrite).resolves.toBe('durable.bin')
    if (trustAssertionFailure) throw trustAssertionFailure
  })

  it('does not trust residual local bytes after adapter recreation', async () => {
    local.putError = new Error('local write sentinel')
    local.deleteError = new Error('local delete sentinel')
    await expect(mirror.put('durable.bin', 'stale')).rejects.toBeInstanceOf(
      AggregateError,
    )
    expect(await local.get('durable.bin')).toEqual(Buffer.from('stale'))
    remote.objects.delete('durable.bin')
    local.putError = undefined
    local.deleteError = undefined

    const recreated = new S3MirrorStorage(local, remote)

    await expect(recreated.exists('durable.bin')).resolves.toBe(false)
    expect(remote.hasKeys).toEqual(['durable.bin'])
    expect(() => recreated.localPath('durable.bin')).toThrow(/untrusted/i)

    remote.objects.set('durable.bin', Buffer.from('fresh'))
    await expect(recreated.get('durable.bin')).resolves.toEqual(
      Buffer.from('fresh'),
    )
    expect(remote.getKeys).toEqual(['durable.bin'])
    expect(await local.get('durable.bin')).toEqual(Buffer.from('fresh'))
    expect(recreated.localPath('durable.bin')).toBe(
      local.localPath('durable.bin'),
    )
  })

  it('materializes a remote object over stale local bytes and then stays local', async () => {
    await local.put('artifact.bin', 'stale')
    remote.objects.set('artifact.bin', Buffer.from('fresh'))
    const recreated = new S3MirrorStorage(local, remote)

    expect(() => recreated.localPath('artifact.bin')).toThrow(/untrusted/i)
    await expect(recreated.materializeLocalPath('artifact.bin')).resolves.toBe(
      local.localPath('artifact.bin'),
    )
    expect(await local.get('artifact.bin')).toEqual(Buffer.from('fresh'))
    expect(remote.getKeys).toEqual(['artifact.bin'])

    await expect(recreated.materializeLocalPath('artifact.bin')).resolves.toBe(
      local.localPath('artifact.bin'),
    )
    expect(remote.getKeys).toEqual(['artifact.bin'])
    expect(recreated.localPath('artifact.bin')).toBe(local.localPath('artifact.bin'))
  })

  it('reads locally first and refills a missing cache from remote', async () => {
    remote.objects.set('remote-only.bin', Buffer.from('remote'))
    await mirror.put('local.bin', 'local')

    await expect(mirror.get('local.bin')).resolves.toEqual(Buffer.from('local'))
    expect(remote.getKeys).toEqual([])
    await expect(mirror.get('remote-only.bin')).resolves.toEqual(
      Buffer.from('remote'),
    )
    expect(await local.get('remote-only.bin')).toEqual(Buffer.from('remote'))
    await expect(mirror.get('missing.bin')).rejects.toThrow(/missing/)
  })

  it('checks local existence before remote existence', async () => {
    await mirror.put('local.bin', 'local')
    remote.objects.set('remote.bin', Buffer.from('remote'))

    await expect(mirror.exists('local.bin')).resolves.toBe(true)
    expect(remote.hasKeys).toEqual([])
    await expect(mirror.exists('remote.bin')).resolves.toBe(true)
    await expect(mirror.exists('missing.bin')).resolves.toBe(false)
  })

  it('deletes missing objects idempotently on both sides', async () => {
    await expect(mirror.delete('missing.bin')).resolves.toBeUndefined()
    await expect(mirror.delete('missing.bin')).resolves.toBeUndefined()
    expect(remote.deleteKeys).toEqual(['missing.bin', 'missing.bin'])
  })

  it('still deletes remote when local delete fails and returns a safe error', async () => {
    await mirror.put('artifact.bin', 'bytes')
    local.deleteError = new Error('local path sentinel')

    const operation = mirror.delete('artifact.bin')

    await expect(operation).rejects.toThrow('存储对象删除失败')
    await expect(operation).rejects.not.toThrow('local path sentinel')
    expect(remote.objects.has('artifact.bin')).toBe(false)
  })

  it('keeps localPath untrusted after a retry deletes quarantined bytes', async () => {
    await mirror.put('artifact.bin', 'bytes')
    local.deleteError = new Error('local path sentinel')

    await expect(mirror.delete('artifact.bin')).rejects.toThrow(
      '存储对象删除失败',
    )

    await expect(mirror.exists('artifact.bin')).resolves.toBe(false)
    expect(remote.hasKeys).toEqual(['artifact.bin'])
    expect(() => mirror.localPath('artifact.bin')).toThrow(/untrusted/i)

    local.deleteError = undefined
    await expect(mirror.delete('artifact.bin')).resolves.toBeUndefined()
    expect(() => mirror.localPath('artifact.bin')).toThrow(/untrusted/i)
  })

  it('still deletes local when remote delete fails and returns a safe error', async () => {
    await mirror.put('artifact.bin', 'bytes')
    remote.deleteError = new Error('remote endpoint sentinel')

    const operation = mirror.delete('artifact.bin')

    await expect(operation).rejects.toThrow('存储对象删除失败')
    await expect(operation).rejects.not.toThrow('remote endpoint sentinel')
    expect(await local.exists('artifact.bin')).toBe(false)
    expect(remote.objects.has('artifact.bin')).toBe(true)
    expect(() => mirror.localPath('artifact.bin')).toThrow(/untrusted/i)
  })
})

describe('storage factory', () => {
  it('defaults to local and accepts explicit local mode', async () => {
    const { createStorage } = await import('./index')
    expect(createStorage({})).toBeInstanceOf(LocalFsStorage)
    expect(createStorage({ STORAGE_MODE: 'local' })).toBeInstanceOf(
      LocalFsStorage,
    )
  })

  it('creates s3-mirror storage when all required variables exist', async () => {
    const { createStorage } = await import('./index')
    expect(createStorage(validS3Environment())).toBeInstanceOf(S3MirrorStorage)
  })

  it('rejects an unknown mode without echoing its raw value', async () => {
    const { createStorage } = await import('./index')
    const rawMode = 'secret-mode-sentinel'

    expect(() => createStorage({ STORAGE_MODE: rawMode })).toThrow(
      'local | s3-mirror',
    )
    expect(() => createStorage({ STORAGE_MODE: rawMode })).not.toThrow(rawMode)
  })

  it('names each missing S3 variable without echoing configured secrets', async () => {
    const { createStorage } = await import('./index')
    const required = [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const

    for (const missing of required) {
      const environment = validS3Environment()
      delete environment[missing]
      let thrown: unknown
      try {
        createStorage(environment)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      const message = (thrown as Error).message
      expect(message).toContain(missing)
      expect(message).not.toContain('endpoint-sentinel')
      expect(message).not.toContain('bucket-sentinel')
      expect(message).not.toContain('access-sentinel')
      expect(message).not.toContain('secret-sentinel')
    }
  })
})

function validS3Environment(): Record<string, string> {
  return {
    STORAGE_MODE: 's3-mirror',
    S3_ENDPOINT: 'https://endpoint-sentinel.invalid',
    S3_BUCKET: 'bucket-sentinel',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'access-sentinel',
    S3_SECRET_ACCESS_KEY: 'secret-sentinel',
  }
}
