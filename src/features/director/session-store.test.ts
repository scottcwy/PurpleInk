import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalFsStorage } from '@/lib/storage/local-fs'
import type { RemoteObjectStore } from '@/lib/storage/remote-store'
import { S3MirrorStorage } from '@/lib/storage/s3-mirror'
import type { StorageAdapter } from '@/lib/storage/types'
import { DirectorSessionStore } from './session-store'

vi.mock('server-only', () => ({}))

describe('DirectorSessionStore', () => {
  let tempRoot: string
  let storage: StorageAdapter
  let localStorage: LocalFsStorage
  let getMock: ReturnType<typeof vi.fn<StorageAdapter['get']>>
  let putMock: ReturnType<typeof vi.fn<StorageAdapter['put']>>
  let tempDirMock: ReturnType<typeof vi.fn<StorageAdapter['tempDir']>>
  let removeTempDirMock: ReturnType<
    typeof vi.fn<StorageAdapter['removeTempDir']>
  >
  let stagingDirectories: string[]

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'cvc-director-session-'))
    localStorage = new LocalFsStorage(tempRoot)
    stagingDirectories = []
    getMock = vi.fn((key) => localStorage.get(key))
    putMock = vi.fn((key, data) => localStorage.put(key, data))
    tempDirMock = vi.fn(async (prefix) => {
      const directory = await localStorage.tempDir(prefix)
      stagingDirectories.push(directory)
      return directory
    })
    removeTempDirMock = vi.fn((directory) =>
      localStorage.removeTempDir(directory)
    )
    storage = {
      put: putMock,
      get: getMock,
      exists: (key) => localStorage.exists(key),
      localPath: (key) => localStorage.localPath(key),
      materializeLocalPath: (key) => localStorage.materializeLocalPath(key),
      delete: (key) => localStorage.delete(key),
      tempDir: tempDirMock,
      readLocalFile: (absolutePath) => localStorage.readLocalFile(absolutePath),
      removeTempDir: removeTempDirMock,
    }
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
    await Promise.all(
      stagingDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      ),
    )
  })

  it('stages JSONL locally and uploads it on close under a relative key', async () => {
    const store = new DirectorSessionStore(storage)
    const handle = await store.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })

    expect(tempDirMock).toHaveBeenCalledWith('pi-session-')
    expect(path.isAbsolute(handle.storageKey)).toBe(false)
    expect(handle.storageKey.replaceAll('\\', '/')).toMatch(/^pi-sessions\/.+\.jsonl$/)
    expect(await storage.exists(handle.storageKey)).toBe(false)
    await store.close()
    expect(await storage.exists(handle.storageKey)).toBe(true)
    expect(putMock).toHaveBeenCalledWith(handle.storageKey, expect.any(Buffer))
    expect(removeTempDirMock).toHaveBeenCalledOnce()
  })

  it('restores persisted messages through Session.buildContext', async () => {
    const firstStore = new DirectorSessionStore(storage)
    const created = await firstStore.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'DIRECT',
    })
    const message: AgentMessage = {
      role: 'user',
      content: [{ type: 'text', text: '恢复这条消息' }],
      timestamp: 1,
    }
    await created.session.appendMessage(message)
    await firstStore.close()

    const secondStore = new DirectorSessionStore(storage)
    const resumed = await secondStore.resume(created.storageKey)
    const context = await resumed.session.buildContext()

    expect(context.messages).toEqual([message])
    expect(resumed.storageKey).toBe(created.storageKey)
    await secondStore.close()
  })

  it('uploads once when close is called repeatedly', async () => {
    const store = new DirectorSessionStore(storage)
    await store.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'DIRECT',
    })

    await store.close()
    await store.close()

    expect(putMock).toHaveBeenCalledOnce()
    expect(removeTempDirMock).toHaveBeenCalledOnce()
  })

  it('discards staging without uploading a session object', async () => {
    const store = new DirectorSessionStore(storage)
    const handle = await store.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'DIRECT',
    })
    const stagingDirectory = stagingDirectories[0]!

    await store.discard()
    await store.close()

    expect(putMock).not.toHaveBeenCalled()
    await expect(storage.exists(handle.storageKey)).resolves.toBe(false)
    await expect(stat(stagingDirectory)).rejects.toThrow()
    expect(removeTempDirMock).toHaveBeenCalledOnce()
  })

  it('keeps persisted session bytes unchanged when resumed staging is discarded', async () => {
    const firstStore = new DirectorSessionStore(storage)
    const created = await firstStore.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'DIRECT',
    })
    await created.session.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: '已持久化的历史' }],
      timestamp: 1,
    })
    await firstStore.close()
    const persistedBytes = await storage.get(created.storageKey)

    const resumedStore = new DirectorSessionStore(storage)
    const resumed = await resumedStore.resume(created.storageKey)
    await resumed.session.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: '不应写回的追加内容' }],
      timestamp: 2,
    })
    await resumedStore.discard()

    await expect(storage.get(created.storageKey)).resolves.toEqual(persistedBytes)
    expect(putMock).toHaveBeenCalledOnce()
  })

  it('uploads to remote and resumes through a fresh mirror cache', async () => {
    const firstRoot = await mkdtemp(path.join(tmpdir(), 'pi-session-cache-a-'))
    const secondRoot = await mkdtemp(path.join(tmpdir(), 'pi-session-cache-b-'))
    const remote = new MemoryRemoteStore()
    try {
      const firstStorage = new S3MirrorStorage(
        new LocalFsStorage(firstRoot),
        remote,
      )
      const firstStore = new DirectorSessionStore(firstStorage)
      const created = await firstStore.create({
        projectId: 'project-1',
        nodeId: 'node-1',
        stage: 'DIRECT',
      })
      const message: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text: '跨进程恢复' }],
        timestamp: 2,
      }
      await created.session.appendMessage(message)
      await firstStore.close()
      expect(remote.objects.has(created.storageKey)).toBe(true)

      const secondStorage = new S3MirrorStorage(
        new LocalFsStorage(secondRoot),
        remote,
      )
      const secondStore = new DirectorSessionStore(secondStorage)
      const resumed = await secondStore.resume(created.storageKey)

      await expect(resumed.session.buildContext()).resolves.toMatchObject({
        messages: [message],
      })
      await secondStore.close()
    } finally {
      await rm(firstRoot, { recursive: true, force: true })
      await rm(secondRoot, { recursive: true, force: true })
    }
  })

  it('rejects failed uploads and still removes the staging directory', async () => {
    putMock.mockRejectedValueOnce(new Error('remote upload failed'))
    const store = new DirectorSessionStore(storage)
    await store.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'DIRECT',
    })
    const stagingDirectory = stagingDirectories[0]!

    await expect(store.close()).rejects.toThrow('remote upload failed')

    await expect(stat(stagingDirectory)).rejects.toThrow()
    expect(removeTempDirMock).toHaveBeenCalledWith(stagingDirectory)
  })

  it('preserves upload and cleanup failures when both operations fail', async () => {
    const uploadFailure = new Error('remote upload failed')
    const cleanupFailure = new Error('cleanup failed')
    putMock.mockRejectedValueOnce(uploadFailure)
    removeTempDirMock.mockRejectedValueOnce(cleanupFailure)
    const store = new DirectorSessionStore(storage)
    await store.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'DIRECT',
    })

    const failure = await store.close().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toEqual([
      uploadFailure,
      cleanupFailure,
    ])
  })

  it('removes the staging path when session creation fails', async () => {
    const blockedPath = path.join(tempRoot, 'blocked-staging-path')
    await writeFile(blockedPath, 'not a directory')
    tempDirMock.mockResolvedValueOnce(blockedPath)
    const store = new DirectorSessionStore(storage)

    await expect(
      store.create({
        projectId: 'project-1',
        nodeId: 'node-1',
        stage: 'DIRECT',
      }),
    ).rejects.toThrow()

    expect(removeTempDirMock).toHaveBeenCalledWith(blockedPath)
    await expect(stat(blockedPath)).rejects.toThrow()
  })

  it('removes the staging directory when persisted JSONL cannot be opened', async () => {
    getMock.mockResolvedValueOnce(Buffer.from('not-json\n'))
    const store = new DirectorSessionStore(storage)

    await expect(
      store.resume('pi-sessions/project-1/broken.jsonl'),
    ).rejects.toThrow('Invalid JSONL session file')

    const stagingDirectory = stagingDirectories[0]!
    expect(removeTempDirMock).toHaveBeenCalledWith(stagingDirectory)
    await expect(stat(stagingDirectory)).rejects.toThrow()
  })

  it('rejects resume keys outside the pi-sessions storage prefix', async () => {
    const store = new DirectorSessionStore(storage)
    await expect(store.resume('../outside.jsonl')).rejects.toThrow('非法 Pi 会话 storageKey')
    expect(getMock).not.toHaveBeenCalled()
    expect(tempDirMock).not.toHaveBeenCalled()
    await store.close()
  })
})

class MemoryRemoteStore implements RemoteObjectStore {
  readonly objects = new Map<string, Buffer>()

  async putObject(key: string, data: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(data))
  }

  async getObject(key: string): Promise<Buffer | null> {
    const found = this.objects.get(key)
    return found ? Buffer.from(found) : null
  }

  async getObjectMetadata(key: string): Promise<Record<string, string> | null> {
    return this.objects.has(key) ? {} : null
  }

  async hasObject(key: string): Promise<boolean> {
    return this.objects.has(key)
  }

  async presignGetUrl(key: string): Promise<string> {
    return `https://example.test/${key}`
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key)
  }
}
