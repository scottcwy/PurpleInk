import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  insertArtifact,
  OTHER_WORKSPACE_ID,
  seedRenderFixture,
  TEST_WORKSPACE_ID,
  type RenderFixture,
} from './render.pg-fixture'
import { RenderRepository } from './repository'

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

describe('RenderRepository Postgres', () => {
  it('loads async render contexts from versioned payloads and trusted artifacts', async () => {
    const repository = new RenderRepository(database.db)
    await expect(
      repository.loadCompletedThumbnailContext(
        fixture.projectId,
        fixture.codegenNodeId
      )
    ).resolves.toMatchObject({
      projectId: fixture.projectId,
      nodeId: fixture.codegenNodeId,
      htmlKey: 'director/S001.html',
      frames: {
        fps: 30,
        durationInFrames: 60,
        width: 1920,
        height: 1080,
      },
    })
    await expect(
      repository.loadRenderAdmissionContext(
        fixture.projectId,
        fixture.codegenNodeId
      )
    ).rejects.toThrow('不可入队：success')
  })

  it('keeps export plans isolated by workspace and maps succeeded to success', async () => {
    await seedRenderFixture(
      database.db,
      OTHER_WORKSPACE_ID,
      fixture.projectId
    )
    await insertArtifact(database.db, {
      projectId: fixture.projectId,
      aggregateId: fixture.codegenNodeId,
      attemptId: fixture.nodeAttemptId,
      kind: 'render-mp4',
      storageKey: 'render/S001.mp4',
    })
    const plan = await new RenderRepository(database.db).getExportPlan(
      fixture.projectId
    )
    expect(plan.shots).toEqual([
      {
        nodeId: fixture.codegenNodeId,
        laneKey: 'S001',
        outputKey: 'render/S001.mp4',
      },
    ])
    expect(plan.incompleteNodeIds).toEqual([fixture.qaNodeId])
    expect(plan.resolutionPreset).toBe('720x1280')
    expect(plan.targetResolution).toEqual({ width: 720, height: 1280 })
  })

  it('round-trips rule QA inside the versioned node payload', async () => {
    const repository = new RenderRepository(database.db)
    const qaCheck = {
      passed: true,
      checkedAt: 1,
      thumbnailContentHash: 'thumb-hash',
      results: [],
    }
    await repository.writeShotQaCheck(fixture.qaNodeId, qaCheck)
    await expect(repository.readShotQaCheck(fixture.qaNodeId)).resolves.toEqual(
      qaCheck
    )
  })

  it('versions thumbnail artifacts and preserves the attempt fence', async () => {
    const repository = new RenderRepository(database.db)
    const first = await repository.registerThumbnail({
      projectId: fixture.projectId,
      nodeId: fixture.codegenNodeId,
      outputKey: 'thumb/one.png',
      contentHash: 'd'.repeat(64),
      sizeBytes: 11,
    })
    const second = await repository.registerThumbnail({
      projectId: fixture.projectId,
      nodeId: fixture.codegenNodeId,
      outputKey: 'thumb/two.png',
      contentHash: 'e'.repeat(64),
      sizeBytes: 12,
    })
    const rows = await database.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, TEST_WORKSPACE_ID),
          eq(artifacts.kind, 'frame-thumbnail')
        )
      )
      .orderBy(artifacts.version)
    expect(rows.map((row) => [row.id, row.version, row.sizeBytes])).toEqual([
      [first, 1, 11],
      [second, 2, 12],
    ])
    expect(rows[1]?.supersedesArtifactId).toBe(first)
    expect(rows.every((row) => row.attemptId === fixture.nodeAttemptId)).toBe(
      true
    )
  })

  it('commits Vision report and node projection in one transaction', async () => {
    const repository = new RenderRepository(database.db)
    const result = await repository.registerVisionReport({
      projectId: fixture.projectId,
      nodeId: fixture.qaNodeId,
      outputKey: 'qa/S001.json',
      contentHash: 'f'.repeat(64),
      sizeBytes: 99,
      buildProjection: (artifactId) => ({
        passed: true,
        checkedAt: 2,
        thumbnailContentHash: 'thumbs',
        provider: 'stepfun',
        model: 'vision',
        summary: '通过',
        reportArtifactId: artifactId,
        reportKey: 'qa/S001.json',
      }),
    })
    const [node] = await database.db
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, TEST_WORKSPACE_ID),
          eq(canvasNodes.id, fixture.qaNodeId)
        )
      )
    expect(node?.data).toMatchObject({
      schemaVersion: 1,
      payload: {
        qaVision: {
          reportArtifactId: result.artifactId,
          reportKey: 'qa/S001.json',
        },
      },
    })
  })

  it('rolls back the Vision artifact when its node projection fails', async () => {
    const repository = new RenderRepository(database.db)
    await expect(
      repository.registerVisionReport({
        projectId: fixture.projectId,
        nodeId: fixture.qaNodeId,
        outputKey: 'qa/rollback.json',
        contentHash: '1'.repeat(64),
        sizeBytes: 21,
        buildProjection: () => {
          throw new Error('projection failed')
        },
      })
    ).rejects.toThrow('projection failed')

    const rows = await database.db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, TEST_WORKSPACE_ID),
          eq(artifacts.kind, 'qa-vision-report')
        )
      )
    expect(rows).toEqual([])
  })
})
