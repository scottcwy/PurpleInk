import type { LocalFsStorage } from './local-fs'
import type { RemoteObjectStore } from './remote-store'
import type { StorageAdapter } from './types'

/**
 * 写穿（write-through）存储：本地 FS 做渲染工作区与热缓存，远端对象存储做持久层。
 *
 * - put 双写：远端确认成功才算成功（Artifact 不可变约束要求持久层先行）。
 * - get / ensureLocal 本地优先，缺失时从远端回填——覆盖服务器重建后旧产物只在远端的场景。
 * - localPath 与临时目录族直接透传本地实现，ffmpeg / Chromium 链路（11 处调用点）零改动。
 */
export class S3MirrorStorage implements StorageAdapter {
  constructor(
    private readonly local: LocalFsStorage,
    private readonly remote: RemoteObjectStore
  ) {}

  async put(key: string, data: Buffer | Uint8Array | string): Promise<string> {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    await this.local.put(key, bytes)
    await this.remote.putObject(key, bytes)
    return key
  }

  async get(key: string): Promise<Buffer> {
    if (await this.local.exists(key)) {
      return this.local.get(key)
    }
    const bytes = await this.remote.getObject(key)
    if (!bytes) {
      throw new Error(`存储对象缺失（本地与远端均无）: ${key}`)
    }
    await this.local.put(key, bytes)
    return bytes
  }

  async exists(key: string): Promise<boolean> {
    if (await this.local.exists(key)) return true
    return this.remote.hasObject(key)
  }

  localPath(key: string): string {
    return this.local.localPath(key)
  }

  /** 确保 key 在本地存在（必要时从远端回填），返回本地绝对路径。渲染入口预热用。 */
  async ensureLocal(key: string): Promise<string> {
    if (!(await this.local.exists(key))) {
      await this.get(key)
    }
    return this.local.localPath(key)
  }

  /** 生成远端限时下载 URL，供产物下载 302 使用。 */
  async presignDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.remote.presignGetUrl(key, ttlSeconds)
  }

  async delete(key: string): Promise<void> {
    await this.local.delete(key)
    await this.remote.deleteObject(key)
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
