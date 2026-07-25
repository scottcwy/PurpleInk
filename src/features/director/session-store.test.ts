import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalFsStorage } from '@/lib/storage/local-fs'
import type { StorageAdapter } from '@/lib/storage/types'
import { DirectorSessionStore } from './session-store'

vi.mock('server-only', () => ({}))

describe('DirectorSessionStore', () => {
  let tempRoot: string
  let storage: StorageAdapter
  let localPathMock: ReturnType<typeof vi.fn<(key: string) => string>>

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'cvc-director-session-'))
    const localStorage = new LocalFsStorage(tempRoot)
    localPathMock = vi.fn((key: string) => localStorage.localPath(key))
    storage = {
      put: (key, data) => localStorage.put(key, data),
      get: (key) => localStorage.get(key),
      exists: (key) => localStorage.exists(key),
      localPath: localPathMock,
      delete: (key) => localStorage.delete(key),
      tempDir: (prefix) => localStorage.tempDir(prefix),
      readLocalFile: (absolutePath) => localStorage.readLocalFile(absolutePath),
      removeTempDir: (absolutePath) => localStorage.removeTempDir(absolutePath),
    }
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('creates JSONL under the storage-managed root and returns a relative key', async () => {
    const store = new DirectorSessionStore(storage)
    const handle = await store.create({
      projectId: 'project-1',
      nodeId: 'node-1',
      stage: 'INGEST',
    })

    expect(localPathMock).toHaveBeenCalledWith('pi-sessions')
    expect(path.isAbsolute(handle.storageKey)).toBe(false)
    expect(handle.storageKey.replaceAll('\\', '/')).toMatch(/^pi-sessions\/.+\.jsonl$/)
    expect(await storage.exists(handle.storageKey)).toBe(true)
    await store.close()
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

  it('rejects resume keys outside the pi-sessions storage prefix', async () => {
    const store = new DirectorSessionStore(storage)
    await expect(store.resume('../outside.jsonl')).rejects.toThrow('非法 Pi 会话 storageKey')
    await store.close()
  })
})
