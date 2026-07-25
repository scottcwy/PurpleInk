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

/**
 * Pi 会话的 JSONL 持久化。
 *
 * 会话文件必须留在 `storage.localPath('pi-sessions')` 之内：`storageKey` 对外
 * 始终是相对路径（与 artifact 指针同一口径），resume 时先校验前缀再落到绝对路径。
 * 这里直接用 node:fs 读写绝对路径，是因为 pi 的会话存储以本机文件为契约，
 * 与渲染层用 `localPath()` 交给 ffmpeg 的做法一致。
 */
export class DirectorSessionStore {
  private readonly fs: SessionFileSystem = createSessionFileSystem()

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
    const root = this.root()
    const filePath = this.resolveInsideRoot(root, storageKey)
    const sessionStorage = await JsonlSessionStorage.create(this.fs, filePath, {
      cwd: root,
      sessionId,
    })
    return { id: sessionId, storageKey, session: new Session(sessionStorage) }
  }

  async resume(storageKey: string): Promise<StoredDirectorSession> {
    const root = this.root()
    const filePath = this.resolveInsideRoot(root, storageKey)
    const sessionStorage = await JsonlSessionStorage.open(this.fs, filePath)
    const metadata = await sessionStorage.getMetadata()
    return {
      id: metadata.id,
      storageKey: normalizeKey(storageKey),
      session: new Session(sessionStorage),
    }
  }

  /** JSONL 是逐条 append，没有需要 flush 的句柄；保留方法以固定调用方生命周期。 */
  async close(): Promise<void> {}

  private root(): string {
    return this.storage.localPath(SESSION_ROOT)
  }

  private resolveInsideRoot(root: string, storageKey: string): string {
    const key = normalizeKey(storageKey)
    const prefix = `${SESSION_ROOT}/`
    if (!key.startsWith(prefix) || key.length === prefix.length) {
      throw new Error(`非法 Pi 会话 storageKey：${storageKey}`)
    }
    const resolvedRoot = path.resolve(root)
    const resolved = path.resolve(resolvedRoot, key.slice(prefix.length))
    if (!resolved.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`非法 Pi 会话 storageKey：${storageKey}`)
    }
    return resolved
  }
}

function normalizeKey(storageKey: string): string {
  return storageKey.replaceAll('\\', '/')
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
