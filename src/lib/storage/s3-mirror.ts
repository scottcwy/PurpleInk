import type { RemoteObjectStore } from './remote-store'
import { canonicalizeStorageKey } from './storage-key'
import type { StorageAdapter } from './types'

/** Local hot cache backed by an S3-compatible durable object store. */
export class S3MirrorStorage implements StorageAdapter {
  constructor(
    private readonly local: StorageAdapter,
    private readonly remote: RemoteObjectStore,
  ) {}

  async put(key: string, data: Buffer | Uint8Array | string): Promise<string> {
    const canonicalKey = canonicalizeStorageKey(key)
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    await this.remote.putObject(canonicalKey, bytes)
    try {
      await this.local.put(canonicalKey, bytes)
    } catch (writeError) {
      try {
        await this.local.delete(canonicalKey)
      } catch (deleteError) {
        throw new AggregateError(
          [writeError, deleteError],
          '本地缓存写入失败且清理失败',
        )
      }
      throw writeError
    }
    return canonicalKey
  }

  async get(key: string): Promise<Buffer> {
    const canonicalKey = canonicalizeStorageKey(key)
    if (await this.local.exists(canonicalKey)) {
      return this.local.get(canonicalKey)
    }
    const bytes = await this.remote.getObject(canonicalKey)
    if (!bytes) {
      throw new Error(`存储对象缺失: ${canonicalKey}`)
    }
    await this.local.put(canonicalKey, bytes)
    return bytes
  }

  async exists(key: string): Promise<boolean> {
    const canonicalKey = canonicalizeStorageKey(key)
    if (await this.local.exists(canonicalKey)) return true
    return this.remote.hasObject(canonicalKey)
  }

  localPath(key: string): string {
    return this.local.localPath(canonicalizeStorageKey(key))
  }

  async delete(key: string): Promise<void> {
    const canonicalKey = canonicalizeStorageKey(key)
    const results = await Promise.allSettled([
      this.local.delete(canonicalKey),
      this.remote.deleteObject(canonicalKey),
    ])
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('存储对象删除失败')
    }
  }

  async tempDir(prefix: string): Promise<string> {
    return this.local.tempDir(prefix)
  }

  async readLocalFile(absolutePath: string): Promise<Buffer> {
    return this.local.readLocalFile(absolutePath)
  }

  async removeTempDir(absolutePath: string): Promise<void> {
    await this.local.removeTempDir(absolutePath)
  }
}
