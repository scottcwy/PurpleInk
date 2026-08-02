import 'server-only'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  FileError,
  JsonlSessionStorage,
  Session,
  err,
  ok,
  type FileSystem,
  type Result,
} from '@earendil-works/pi-agent-core'
import type { StorageAdapter } from '@/lib/storage'
import { canonicalizeStorageKey } from '@/lib/storage/storage-key'
import type { PipelineStage } from './types'

export interface SessionStoreInput {
  projectId: string
  nodeId: string
  nodeType?: string | null
  stage: PipelineStage
  resumeSessionKey?: string
}

export interface StoredDirectorSession {
  id: string
  storageKey: string
  session: Session
}

/** 所有 Pi 会话 JSONL 都落在 storage 管理的这个前缀下。 */
const SESSION_ROOT = 'pi-sessions'

/** JsonlSessionStorage 只需要这四个文件能力。 */
type SessionFileSystem = Pick<
  FileSystem,
  'readTextFile' | 'readTextLines' | 'writeFile' | 'appendFile'
>

/** Pi 会话在隔离临时目录内追加 JSONL，close 时持久化到 storageKey。 */
export class DirectorSessionStore {
  private readonly fs: SessionFileSystem = createSessionFileSystem()
  private active: {
    storageKey: string
    filePath: string
    tempDirectory: string
  } | undefined

  constructor(private readonly storage: StorageAdapter) {}

  /** 有 resumeSessionKey 就续接，否则新建。 */
  async open(input: SessionStoreInput): Promise<StoredDirectorSession> {
    return input.resumeSessionKey === undefined
      ? this.create(input)
      : this.resume(input.resumeSessionKey)
  }

  async create(
    input: Omit<SessionStoreInput, 'resumeSessionKey'>,
  ): Promise<StoredDirectorSession> {
    const sessionId = randomUUID()
    const storageKey = [
      SESSION_ROOT,
      safeSegment(input.projectId),
      `${safeSegment(input.nodeId)}-${sessionId}.jsonl`,
    ].join('/')
    const tempDirectory = await this.storage.tempDir('pi-session-')
    const filePath = path.join(tempDirectory, path.posix.basename(storageKey))
    try {
      const sessionStorage = await JsonlSessionStorage.create(
        this.fs,
        filePath,
        { cwd: tempDirectory, sessionId },
      )
      this.active = { storageKey, filePath, tempDirectory }
      return { id: sessionId, storageKey, session: new Session(sessionStorage) }
    } catch (error) {
      return this.failConstruction(tempDirectory, error)
    }
  }

  async resume(storageKey: string): Promise<StoredDirectorSession> {
    const key = validateSessionKey(storageKey)
    const bytes = await this.storage.get(key)
    const tempDirectory = await this.storage.tempDir('pi-session-')
    const filePath = path.join(tempDirectory, path.posix.basename(key))
    try {
      await writeFile(filePath, bytes)
      const sessionStorage = await JsonlSessionStorage.open(this.fs, filePath)
      const metadata = await sessionStorage.getMetadata()
      this.active = { storageKey: key, filePath, tempDirectory }
      return {
        id: metadata.id,
        storageKey: key,
        session: new Session(sessionStorage),
      }
    } catch (error) {
      return this.failConstruction(tempDirectory, error)
    }
  }

  async close(): Promise<void> {
    const active = this.active
    if (!active) return
    this.active = undefined
    let persistenceFailed = false
    let persistenceError: unknown
    try {
      const bytes = await this.storage.readLocalFile(active.filePath)
      await this.storage.put(active.storageKey, bytes)
    } catch (error) {
      persistenceFailed = true
      persistenceError = error
    }
    try {
      await this.storage.removeTempDir(active.tempDirectory)
    } catch (cleanupError) {
      if (persistenceFailed) {
        throw new AggregateError(
          [persistenceError, cleanupError],
          'Pi 会话持久化失败且临时目录清理失败',
        )
      }
      throw cleanupError
    }
    if (persistenceFailed) throw persistenceError
  }

  /** 放弃未提交的 staging，只清理本地临时目录。 */
  async discard(): Promise<void> {
    const active = this.active
    if (!active) return
    this.active = undefined
    await this.storage.removeTempDir(active.tempDirectory)
  }

  private async failConstruction(
    tempDirectory: string,
    failure: unknown,
  ): Promise<never> {
    try {
      await this.storage.removeTempDir(tempDirectory)
    } catch (cleanupError) {
      throw new AggregateError(
        [failure, cleanupError],
        'Pi 会话构造失败且临时目录清理失败',
      )
    }
    throw failure
  }
}

function validateSessionKey(storageKey: string): string {
  let key: string
  try {
    key = canonicalizeStorageKey(storageKey)
  } catch {
    throw new Error(`非法 Pi 会话 storageKey：${storageKey}`)
  }
  const prefix = `${SESSION_ROOT}/`
  if (!key.startsWith(prefix) || key.length === prefix.length) {
    throw new Error(`非法 Pi 会话 storageKey：${storageKey}`)
  }
  return key
}

/** storageKey 只允许安全字符，避免 DB 里的标识符污染路径。 */
function safeSegment(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/g, '-')
  if (safe.length === 0 || safe === '.' || safe === '..') {
    throw new Error(`非法 Pi 会话路径段：${value}`)
  }
  return safe
}

function createSessionFileSystem(): SessionFileSystem {
  const readTextFile = async (
    filePath: string,
  ): Promise<Result<string, FileError>> => {
    try {
      return ok(await readFile(filePath, 'utf8'))
    } catch (error) {
      return err(toFileError(error, filePath))
    }
  }
  return {
    readTextFile,
    readTextLines: async (filePath, options) => {
      const read = await readTextFile(filePath)
      if (!read.ok) return read
      const lines = read.value.split(/\r?\n/)
      return ok(
        options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines),
      )
    },
    writeFile: async (filePath, content) => {
      try {
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, content)
        return ok(undefined)
      } catch (error) {
        return err(toFileError(error, filePath))
      }
    },
    appendFile: async (filePath, content) => {
      try {
        await mkdir(path.dirname(filePath), { recursive: true })
        await appendFile(filePath, content)
        return ok(undefined)
      } catch (error) {
        return err(toFileError(error, filePath))
      }
    },
  }
}

function toFileError(error: unknown, filePath: string): FileError {
  const code = (error as { code?: string } | null)?.code
  if (code === 'ENOENT') return new FileError('not_found', 'Pi 会话文件不存在', filePath)
  if (code === 'EACCES' || code === 'EPERM') {
    return new FileError('permission_denied', 'Pi 会话文件不可访问', filePath)
  }
  if (code === 'EISDIR') {
    return new FileError('is_directory', 'Pi 会话路径是目录', filePath)
  }
  return new FileError('unknown', 'Pi 会话文件操作失败', filePath)
}
