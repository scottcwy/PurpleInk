import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { LocalFsStorage } from '@/lib/storage'
import {
  seedRenderFixture,
  TEST_WORKSPACE_ID,
  type RenderFixture,
} from './render.pg-fixture'
import { RenderRepository } from './repository'
import { captureThumbnails } from './thumbnail'
import type { ThumbnailContext } from './types'

vi.mock('server-only', () => ({}))

let database: PgTestDatabase
let directory: string
let fixture: RenderFixture
let storage: LocalFsStorage
let repository: RenderRepository
let context: ThumbnailContext

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  fixture = await seedRenderFixture(database.db)
  directory = path.join(os.tmpdir(), `cvc-thumbnail-e2e-${randomUUID()}`)
  storage = new LocalFsStorage(path.join(directory, 'artifacts'))
  repository = new RenderRepository(database.db)
  const html = await readFile(
    new URL('./__fixtures__/deterministic-shot.html', import.meta.url)
  )
  await storage.put('director/S001.html', html)
  await database.db
    .update(canvasNodes)
    .set({
      data: {
        schemaVersion: 1,
        payload: {
          laneKey: 'S001',
          laneRole: 'shot-codegen',
          renderSpec: {
            fps: 24,
            durationInFrames: 12,
            width: 320,
            height: 180,
          },
        },
      },
    })
    .where(
      and(
        eq(canvasNodes.workspaceId, TEST_WORKSPACE_ID),
        eq(canvasNodes.id, fixture.codegenNodeId)
      )
    )
  context = await repository.loadCompletedThumbnailContext(
    fixture.projectId,
    fixture.codegenNodeId
  )
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

afterAll(async () => {
  await database.close()
})

describe('captureThumbnails Postgres integration', () => {
  it('extracts real PNG frames and registers frame-thumbnail artifacts', async () => {
    const results = await captureThumbnails(
      context,
      [{ fraction: 0.25 }, { fraction: 0.95 }],
      { storage, repository }
    )

    expect(results).toHaveLength(2)
    for (const result of results) {
      const [row] = await database.db
        .select({
          storageKey: artifacts.storageKey,
          kind: artifacts.kind,
        })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.workspaceId, TEST_WORKSPACE_ID),
            eq(artifacts.id, result.artifactId)
          )
        )
        .limit(1)
      expect(row?.kind).toBe('frame-thumbnail')
      const bytes = await storage.get(row!.storageKey)
      expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
    }
  }, 30_000)

  it('reuses the same artifact on a second call for the same targets', async () => {
    const targets = [{ fraction: 0.25 }, { fraction: 0.6 }]
    const first = await captureThumbnails(context, targets, {
      storage,
      repository,
    })
    const second = await captureThumbnails(context, targets, {
      storage,
      repository,
    })
    expect(second).toEqual(first)
  }, 30_000)

  it('throws a clear error when the node has no renderSpec yet', async () => {
    await database.db
      .update(canvasNodes)
      .set({
        data: {
          schemaVersion: 1,
          payload: {
            laneKey: 'S001',
            laneRole: 'shot-codegen',
          },
        },
      })
      .where(
        and(
          eq(canvasNodes.workspaceId, TEST_WORKSPACE_ID),
          eq(canvasNodes.id, fixture.codegenNodeId)
        )
      )

    await expect(
      repository.loadCompletedThumbnailContext(
        fixture.projectId,
        fixture.codegenNodeId
      )
    ).rejects.toThrow('renderSpec 无效')
  })
})
