import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import {
  drainAllStorageCleanupRequests,
  drainStorageCleanupRequest,
  drainStorageCleanupRequests,
  enqueueStorageCleanupRequest,
} from './cleanup-outbox'
import { LocalFsStorage } from './local-fs'
import type { RemoteObjectStore } from './remote-store'
import { S3MirrorStorage } from './s3-mirror'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const SECOND_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const RUN_ID = '20000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000001'
const ARTIFACT_ID = '40000000-0000-4000-8000-000000000001'
const STORAGE_KEY =
  `project-sources/${WORKSPACE_ID}/${PROJECT_ID}/`
  + `${'a'.repeat(64)}.wav`
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${WORKSPACE_ID}, 'cleanup-outbox', 'Cleanup Outbox')
  `
})
afterAll(async () => database.close())

it('atomically claims due cleanup work and removes it after storage deletion', async () => {
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      storageKey: STORAGE_KEY,
      reason: 'creation-failed',
    },
    { database: database.db },
  )
  const storage = { delete: vi.fn(async () => undefined) }

  const result = await drainStorageCleanupRequests(
    { workspaceId: WORKSPACE_ID, limit: 10 },
    { database: database.db, storage },
  )

  expect(result).toEqual({ claimed: 1, deleted: 1, deferred: 0 })
  expect(storage.delete).toHaveBeenCalledWith(STORAGE_KEY)
  const [count] = await database.sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM storage_cleanup_requests
  `
  expect(count?.count).toBe(0)
})

it('keeps failed cleanup retryable with only a safe failure code', async () => {
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      storageKey: STORAGE_KEY,
      reason: 'duplicate-upload',
    },
    { database: database.db },
  )
  const storage = {
    delete: vi.fn(async () => {
      throw new Error('raw storage endpoint and user content')
    }),
  }

  const result = await drainStorageCleanupRequests(
    { workspaceId: WORKSPACE_ID, limit: 10 },
    { database: database.db, storage },
  )

  expect(result).toEqual({ claimed: 1, deleted: 0, deferred: 1 })
  const rows = await database.sql<{
    attempt_count: number
    failure_code: string
    next_attempt_at: Date
  }[]>`
    SELECT attempt_count, failure_code, next_attempt_at
    FROM storage_cleanup_requests
  `
  expect(rows[0]).toMatchObject({
    attempt_count: 1,
    failure_code: 'STORAGE_DELETE_FAILED',
  })
  expect(new Date(rows[0]?.next_attempt_at ?? 0).getTime()).toBeGreaterThan(Date.now())
  expect(JSON.stringify(rows)).not.toContain('raw storage endpoint')
})

it('retries a failed mirror remote delete and settles it after recovery', async () => {
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      storageKey: STORAGE_KEY,
      reason: 'duplicate-upload',
    },
    { database: database.db },
  )
  const root = mkdtempSync(path.join(tmpdir(), 'purpleink-outbox-mirror-'))
  const remote = new FailOnceDeleteRemoteStore()
  const storage = new S3MirrorStorage(new LocalFsStorage(root), remote)
  await storage.put(STORAGE_KEY, 'bytes')

  try {
    const first = await drainStorageCleanupRequests(
      { workspaceId: WORKSPACE_ID, limit: 10 },
      { database: database.db, storage },
    )

    expect(first).toEqual({ claimed: 1, deleted: 0, deferred: 1 })
    expect(remote.objects.has(STORAGE_KEY)).toBe(true)
    const [deferred] = await database.sql<{
      failure_code: string
      attempt_count: number
    }[]>`
      SELECT failure_code, attempt_count FROM storage_cleanup_requests
    `
    expect(deferred).toEqual({
      failure_code: 'STORAGE_DELETE_FAILED',
      attempt_count: 1,
    })
    expect(JSON.stringify(deferred)).not.toContain('remote-endpoint-sentinel')

    await database.sql`
      UPDATE storage_cleanup_requests SET next_attempt_at = now() - interval '1 second'
    `
    const second = await drainStorageCleanupRequests(
      { workspaceId: WORKSPACE_ID, limit: 10 },
      { database: database.db, storage },
    )

    expect(second).toEqual({ claimed: 1, deleted: 1, deferred: 0 })
    expect(remote.objects.has(STORAGE_KEY)).toBe(false)
    await expectCleanupRowCount(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('drains the exact newly-enqueued key even when the workspace has older work', async () => {
  const olderKey = STORAGE_KEY.replace(`${'a'.repeat(64)}.wav`, `${'b'.repeat(64)}.wav`)
  for (const storageKey of [olderKey, STORAGE_KEY]) {
    await enqueueStorageCleanupRequest(
      {
        workspaceId: WORKSPACE_ID,
        storageKey,
        reason: 'creation-failed',
      },
      { database: database.db },
    )
  }
  const storage = { delete: vi.fn(async () => undefined) }

  const result = await drainStorageCleanupRequest(
    { workspaceId: WORKSPACE_ID, storageKey: STORAGE_KEY },
    { database: database.db, storage },
  )

  expect(result).toEqual({ claimed: 1, deleted: 1, deferred: 0 })
  expect(storage.delete).toHaveBeenCalledOnce()
  expect(storage.delete).toHaveBeenCalledWith(STORAGE_KEY)
  const rows = await database.sql<{ storage_key: string }[]>`
    SELECT storage_key FROM storage_cleanup_requests
  `
  expect(rows).toEqual([{ storage_key: olderKey }])
})

it('does not settle a newer same-key request after the old claim deletes storage', async () => {
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      storageKey: STORAGE_KEY,
      reason: 'creation-failed',
    },
    { database: database.db },
  )
  const storage = {
    delete: vi.fn(async () => {
      await enqueueStorageCleanupRequest(
        {
          workspaceId: WORKSPACE_ID,
          storageKey: STORAGE_KEY,
          reason: 'duplicate-upload',
        },
        { database: database.db },
      )
    }),
  }

  await drainStorageCleanupRequests(
    { workspaceId: WORKSPACE_ID, limit: 10 },
    { database: database.db, storage },
  )

  const rows = await database.sql<{
    generation: number
    reason: string
    attempt_count: number
  }[]>`
    SELECT generation, reason, attempt_count
    FROM storage_cleanup_requests
  `
  expect(rows).toEqual([{
    generation: 1,
    reason: 'duplicate-upload',
    attempt_count: 1,
  }])
})

it('does not defer over a newer same-key request when the old delete fails', async () => {
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      storageKey: STORAGE_KEY,
      reason: 'creation-failed',
    },
    { database: database.db },
  )
  const storage = {
    delete: vi.fn(async () => {
      await enqueueStorageCleanupRequest(
        {
          workspaceId: WORKSPACE_ID,
          storageKey: STORAGE_KEY,
          reason: 'duplicate-upload',
        },
        { database: database.db },
      )
      throw new Error('old claimant failed')
    }),
  }

  await drainStorageCleanupRequests(
    { workspaceId: WORKSPACE_ID, limit: 10 },
    { database: database.db, storage },
  )

  const rows = await database.sql<{
    generation: number
    reason: string
    failure_code: string | null
  }[]>`
    SELECT generation, reason, failure_code
    FROM storage_cleanup_requests
  `
  expect(rows).toEqual([{
    generation: 1,
    reason: 'duplicate-upload',
    failure_code: null,
  }])
})

it('keeps bytes when an artifact commit succeeded before the caller observed an error', async () => {
  await seedArtifactReference(STORAGE_KEY)
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      attemptId: ATTEMPT_ID,
      storageKey: STORAGE_KEY,
      reason: 'artifact-registration-failed',
    },
    { database: database.db },
  )
  const storage = { delete: vi.fn(async () => undefined) }

  const result = await drainStorageCleanupRequest(
    { workspaceId: WORKSPACE_ID, storageKey: STORAGE_KEY },
    { database: database.db, storage },
  )

  expect(result).toEqual({ claimed: 1, deleted: 0, deferred: 0 })
  expect(storage.delete).not.toHaveBeenCalled()
  await expectCleanupRowCount(0)
})

it('keeps bytes when a project source commit succeeded before the caller observed an error', async () => {
  await seedAudioProject()
  await database.sql`
    INSERT INTO project_sources (
      workspace_id, project_id, kind, source_payload, source_fingerprint
    ) VALUES (
      ${WORKSPACE_ID}, ${PROJECT_ID}, 'audio',
      ${JSON.stringify({
        schemaVersion: 1,
        kind: 'audio',
        storageKey: STORAGE_KEY,
        fileName: 'source.wav',
        mimeType: 'audio/wav',
        container: 'wav',
        sizeBytes: 1,
        durationMs: 1_000,
        sampleRate: 48_000,
        sampleCount: 48_000,
        visualTheme: 'dark',
      })}::jsonb,
      ${'c'.repeat(64)}
    )
  `
  await enqueueStorageCleanupRequest(
    {
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      storageKey: STORAGE_KEY,
      reason: 'creation-failed',
    },
    { database: database.db },
  )
  const storage = { delete: vi.fn(async () => undefined) }

  const result = await drainStorageCleanupRequest(
    { workspaceId: WORKSPACE_ID, storageKey: STORAGE_KEY },
    { database: database.db, storage },
  )

  expect(result).toEqual({ claimed: 1, deleted: 0, deferred: 0 })
  expect(storage.delete).not.toHaveBeenCalled()
  await expectCleanupRowCount(0)
})

async function seedAudioProject(): Promise<void> {
  await database.sql`
    INSERT INTO projects (
      workspace_id, id, title, script, workflow_kind, workflow_version,
      export_settings
    ) VALUES (
      ${WORKSPACE_ID}, ${PROJECT_ID}, 'Audio project', '', 'audio',
      'audio-v1', '{"schemaVersion":1}'::jsonb
    )
  `
}

async function seedArtifactReference(storageKey: string): Promise<void> {
  await seedAudioProject()
  await database.sql`
    INSERT INTO pipeline_runs (
      workspace_id, id, project_id, status, workflow_version, fingerprint
    ) VALUES (
      ${WORKSPACE_ID}, ${RUN_ID}, ${PROJECT_ID}, 'running', 'audio-v1',
      ${'d'.repeat(64)}
    )
  `
  await database.sql`
    INSERT INTO task_attempts (
      workspace_id, id, run_id, task_id, entity_type, entity_id, attempt_no,
      status, fingerprint, checkpoint
    ) VALUES (
      ${WORKSPACE_ID}, ${ATTEMPT_ID}, ${RUN_ID}, 'audio', 'project',
      ${PROJECT_ID}, 1, 'running', ${'e'.repeat(64)},
      '{"schemaVersion":1}'::jsonb
    )
  `
  await database.sql`
    INSERT INTO artifacts (
      workspace_id, id, project_id, aggregate_type, aggregate_id, kind, version,
      lifecycle, schema_version, storage_key, size_bytes, content_hash, attempt_id
    ) VALUES (
      ${WORKSPACE_ID}, ${ARTIFACT_ID}, ${PROJECT_ID}, 'project', ${PROJECT_ID},
      'audio-source', 1, 'draft', 'cvc.audio/v1', ${storageKey}, 1,
      ${'f'.repeat(64)}, ${ATTEMPT_ID}
    )
  `
}

async function expectCleanupRowCount(expected: number): Promise<void> {
  const [row] = await database.sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM storage_cleanup_requests
  `
  expect(row?.count).toBe(expected)
}

it('globally drains a bounded batch across workspaces', async () => {
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${SECOND_WORKSPACE_ID}, 'cleanup-outbox-2', 'Cleanup Outbox 2')
  `
  const keys = [
    STORAGE_KEY,
    STORAGE_KEY.replace(`${'a'.repeat(64)}.wav`, `${'b'.repeat(64)}.wav`),
    STORAGE_KEY.replace(`${'a'.repeat(64)}.wav`, `${'c'.repeat(64)}.wav`),
  ]
  await enqueueStorageCleanupRequest({
    workspaceId: WORKSPACE_ID,
    storageKey: keys[0]!,
    reason: 'creation-failed',
  }, { database: database.db })
  await enqueueStorageCleanupRequest({
    workspaceId: SECOND_WORKSPACE_ID,
    storageKey: keys[1]!,
    reason: 'creation-failed',
  }, { database: database.db })
  await enqueueStorageCleanupRequest({
    workspaceId: WORKSPACE_ID,
    storageKey: keys[2]!,
    reason: 'creation-failed',
  }, { database: database.db })
  await database.sql`
    UPDATE storage_cleanup_requests
    SET created_at = CASE storage_key
      WHEN ${keys[0]!} THEN now() - interval '3 seconds'
      WHEN ${keys[1]!} THEN now() - interval '2 seconds'
      ELSE now() - interval '1 second'
    END,
    next_attempt_at = now() - interval '10 seconds'
  `
  const storage = { delete: vi.fn(async (_key: string) => undefined) }

  const result = await drainAllStorageCleanupRequests(
    { limit: 2 },
    { database: database.db, storage },
  )

  expect(result).toEqual({ claimed: 2, deleted: 2, deferred: 0 })
  expect(storage.delete.mock.calls.map(([key]) => key)).toEqual(keys.slice(0, 2))
  const rows = await database.sql<{
    workspace_id: string
    storage_key: string
  }[]>`
    SELECT workspace_id, storage_key
    FROM storage_cleanup_requests
  `
  expect(rows).toEqual([{
    workspace_id: WORKSPACE_ID,
    storage_key: keys[2],
  }])
})

class FailOnceDeleteRemoteStore implements RemoteObjectStore {
  readonly objects = new Map<string, Buffer>()
  private shouldFailDelete = true

  async putObject(key: string, data: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(data))
  }

  async getObject(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null
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
    if (this.shouldFailDelete) {
      this.shouldFailDelete = false
      throw new Error('remote-endpoint-sentinel')
    }
    this.objects.delete(key)
  }
}
