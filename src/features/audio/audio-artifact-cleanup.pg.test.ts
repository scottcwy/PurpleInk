import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  storageCleanupRequests,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import type { StorageAdapter } from '@/lib/storage'
import { AudioArtifactCleanupService } from './audio-artifact-cleanup'

vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => WORKSPACE_ID,
}))
vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'audio-cleanup',
    name: 'Audio Cleanup',
  })
})

afterAll(async () => {
  await database.close()
})

describe('audio Artifact storage cleanup', () => {
  it('persists failed deletion evidence and drains it after storage recovers', async () => {
    const storageKey = `director/${randomUUID()}/orphan.wav`
    const stored = new Set([storageKey])
    let deleteAvailable = false
    const storage = cleanupStorage(stored, async () => {
      if (!deleteAvailable) throw new Error('storage unavailable')
    })
    const cleanup = new AudioArtifactCleanupService(database.db, storage)
    const input = cleanupInput(storageKey)

    await expect(cleanup.discard(input)).rejects.toThrow('STORAGE_DELETE_FAILED')

    await expect(database.db
      .select()
      .from(storageCleanupRequests)
      .where(eq(storageCleanupRequests.storageKey, storageKey)))
      .resolves.toEqual([
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          projectId: input.projectId,
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          storageKey,
          reason: 'artifact-registration-failed',
          attemptCount: 1,
          failureCode: 'STORAGE_DELETE_FAILED',
        }),
      ])
    expect(stored.has(storageKey)).toBe(true)

    deleteAvailable = true
    await database.sql`
      UPDATE storage_cleanup_requests
      SET next_attempt_at = now()
      WHERE workspace_id = ${WORKSPACE_ID}
        AND storage_key = ${storageKey}
    `
    await expect(cleanup.drainPending()).resolves.toEqual({
      claimed: 1,
      deleted: 1,
      deferred: 0,
    })
    expect(stored.has(storageKey)).toBe(false)
    await expect(database.db
      .select()
      .from(storageCleanupRequests)
      .where(eq(storageCleanupRequests.storageKey, storageKey)))
      .resolves.toEqual([])
  })
})

function cleanupInput(storageKey: string) {
  return {
    projectId: randomUUID(),
    nodeId: randomUUID(),
    attemptId: randomUUID(),
    storageKey,
  }
}

function cleanupStorage(
  stored: Set<string>,
  beforeDelete: () => Promise<void>,
): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(),
    exists: async (key) => stored.has(key),
    localPath: (key) => key,
    materializeLocalPath: async (key) => key,
    delete: async (key) => {
      await beforeDelete()
      stored.delete(key)
    },
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}
