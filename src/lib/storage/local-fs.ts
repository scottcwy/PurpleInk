import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StorageAdapter } from './types'

/** 基于本地文件系统的存储适配器，所有 key 相对于 root 目录。 */
export class LocalFsStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    return path.join(this.root, key)
  }

  async put(key: string, data: Buffer | Uint8Array | string): Promise<string> {
    const file = this.resolve(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
    return key
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key))
      return true
    } catch {
      return false
    }
  }

  localPath(key: string): string {
    return this.resolve(key)
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true })
  }

  async tempDir(prefix: string): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), prefix))
  }

  async readLocalFile(absolutePath: string): Promise<Buffer> {
    return readFile(absolutePath)
  }

  async removeTempDir(absolutePath: string): Promise<void> {
    await rm(absolutePath, { recursive: true, force: true })
  }
}
