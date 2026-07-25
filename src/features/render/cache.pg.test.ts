import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitArtifactRecord } from '@/features/artifacts'
import { artifacts, taskAttempts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  insertArtifact,
  seedRenderFixture,
  type RenderFixture,
} from './render.pg-fixture'
import { lookupCache, renderOutputKey, writeCache } from './cache'

vi.mock('server-only', () => ({}))

let database: PgTestDatabase
let fixture: RenderFixture

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  fixture = await seedRenderFixture(database.db)
})

afterAll(async () => {
  await database.close()
})

describe('render cache Postgres', () => {
  it('registers real bytes and returns an existing content-addressed mp4', async () => {
    const bytes = Buffer.from('real-render-bytes')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const lookup = {
      projectId: fixture.projectId,
      nodeId: fixture.codegenNodeId,
      renderKey: 'render-key-1',
    }
    const outputKey = renderOutputKey(lookup)
    const storage = createStorage(bytes, true)
    await writeCache(
      {
        projectId: fixture.projectId,
        nodeId: fixture.codegenNodeId,
        outputKey,
        contentHash,
      },
      { db: database.db, storage }
    )

    await expect(
      lookupCache(lookup, { db: database.db, storage })
    ).resolves.toEqual({ outputKey, contentHash })
  })

  it('rejects a declared hash that does not match stored bytes', async () => {
    const storage = createStorage(Buffer.from('actual'), true)
    await expect(
      writeCache(
        {
          projectId: fixture.projectId,
          nodeId: fixture.codegenNodeId,
          outputKey: 'render/bad.mp4',
          contentHash: '0'.repeat(64),
        },
        { db: database.db, storage }
      )
    ).rejects.toThrow('hash 与声明不一致')
  })

  it('treats an artifact with a missing file as a cache miss', async () => {
    await insertArtifact(database.db, {
      projectId: fixture.projectId,
      aggregateId: fixture.codegenNodeId,
      attemptId: fixture.nodeAttemptId,
      kind: 'render-mp4',
      storageKey: renderOutputKey({
        projectId: fixture.projectId,
        nodeId: fixture.codegenNodeId,
        renderKey: 'missing',
      }),
    })
    await expect(
      lookupCache(
        {
          projectId: fixture.projectId,
          nodeId: fixture.codegenNodeId,
          renderKey: 'missing',
        },
        {
          db: database.db,
          storage: createStorage(Buffer.alloc(0), false),
        }
      )
    ).resolves.toBeNull()
  })

  it('rejects an artifact publish from a superseded attempt number', async () => {
    const [current] = await database.db
      .select()
      .from(taskAttempts)
      .where(eq(taskAttempts.id, fixture.nodeAttemptId))
      .limit(1)
    expect(current).toBeDefined()
    await database.db.insert(taskAttempts).values({
      ...current!,
      id: randomUUID(),
      attemptNo: current!.attemptNo + 1,
      status: 'queued',
      fingerprint: 'f'.repeat(64),
    })

    await expect(
      commitArtifactRecord(database.db, {
        workspaceId: current!.workspaceId,
        projectId: fixture.projectId,
        aggregateType: 'node',
        aggregateId: fixture.codegenNodeId,
        kind: 'stale-render',
        schemaVersion: 'cvc.render-cache/v1',
        storageKey: 'render/stale.mp4',
        sizeBytes: 5,
        contentHash: 'd'.repeat(64),
        attemptId: fixture.nodeAttemptId,
      })
    ).rejects.toThrow('STALE_ATTEMPT')

    const rows = await database.db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.projectId, fixture.projectId),
          eq(artifacts.kind, 'stale-render')
        )
      )
    expect(rows).toHaveLength(0)
  })
})

function createStorage(bytes: Buffer, exists: boolean): StorageAdapter {
  return {
    put: vi.fn(),
    get: vi.fn(async () => bytes),
    exists: vi.fn(async () => exists),
    localPath: vi.fn(),
    delete: vi.fn(),
    tempDir: vi.fn(),
    readLocalFile: vi.fn(),
    removeTempDir: vi.fn(),
  }
}
