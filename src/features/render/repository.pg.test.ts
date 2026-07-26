import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  artifacts,
  canvasNodes,
  pipelineRuns,
  taskAttempts,
} from '@/lib/db/schema/index'
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

  it('allows enqueue admission on a genuine first-time node with neither director-fabricate nor renderSpec', async () => {
    const projectId = randomUUID()
    const awaiting = await seedRenderFixture(database.db, TEST_WORKSPACE_ID, projectId, {
      withFabricateArtifact: false,
      codegenStatus: 'idle',
    })
    const repository = new RenderRepository(database.db)

    await expect(
      repository.hasFabricateArtifact(projectId, awaiting.codegenNodeId)
    ).resolves.toBe(false)

    const admission = await repository.loadRenderAdmissionContext(
      projectId,
      awaiting.codegenNodeId
    )
    expect(admission.job).toBeNull()
    expect(admission.enqueue).toEqual({
      projectId,
      nodeId: awaiting.codegenNodeId,
      shotId: 'S001',
    })

    // 首次入队上下文不解析 renderSpec；真正渲染时才要求它存在（此处尚未生成）。
    await expect(
      repository.loadRenderContext(projectId, awaiting.codegenNodeId)
    ).rejects.toThrow('必须处于 running')
  })

  it('surfaces a render-ready job for enqueue admission when the artifact already exists (retry path)', async () => {
    const projectId = randomUUID()
    const retryable = await seedRenderFixture(database.db, TEST_WORKSPACE_ID, projectId, {
      codegenStatus: 'failed',
    })
    const repository = new RenderRepository(database.db)

    await expect(
      repository.hasFabricateArtifact(projectId, retryable.codegenNodeId)
    ).resolves.toBe(true)

    const admission = await repository.loadRenderAdmissionContext(
      projectId,
      retryable.codegenNodeId
    )
    expect(admission.job).toMatchObject({
      projectId,
      nodeId: retryable.codegenNodeId,
      htmlKey: 'director/S001.html',
      frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
    })
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
    expect(plan.resolutionPreset).toBe('1280x720')
    expect(plan.targetResolution).toEqual({ width: 1280, height: 720 })
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

  it('registers thumbnails with no running attempt by inheriting the source HTML lineage', async () => {
    // 生产真实形状：渲染 attempt 已结束（分镜页浏览 / Final QA / shot-qa 触发时都是如此）。
    await database.db
      .update(taskAttempts)
      .set({ status: 'succeeded' })
      .where(eq(taskAttempts.workspaceId, TEST_WORKSPACE_ID))
    await database.db
      .update(pipelineRuns)
      .set({ status: 'succeeded' })
      .where(eq(pipelineRuns.workspaceId, TEST_WORKSPACE_ID))

    const repository = new RenderRepository(database.db)
    const artifactId = await repository.registerThumbnail({
      projectId: fixture.projectId,
      nodeId: fixture.codegenNodeId,
      outputKey: 'thumb/no-attempt.png',
      contentHash: 'a'.repeat(64),
      sizeBytes: 7,
    })

    const [row] = await database.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, TEST_WORKSPACE_ID),
          eq(artifacts.id, artifactId)
        )
      )
    expect(row).toMatchObject({
      kind: 'frame-thumbnail',
      aggregateId: fixture.codegenNodeId,
      attemptId: fixture.nodeAttemptId,
    })
  })

  it('refuses to register a thumbnail when the source HTML artifact is absent', async () => {
    const projectId = randomUUID()
    const bare = await seedRenderFixture(database.db, TEST_WORKSPACE_ID, projectId, {
      withFabricateArtifact: false,
      codegenStatus: 'idle',
    })

    await expect(
      new RenderRepository(database.db).registerThumbnail({
        projectId,
        nodeId: bare.codegenNodeId,
        outputKey: 'thumb/orphan.png',
        contentHash: 'b'.repeat(64),
        sizeBytes: 7,
      })
    ).rejects.toThrow('找不到派生来源产物')
  })

  it('versions thumbnail artifacts and keeps the source HTML lineage', async () => {
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

  it('registers new exports as immutable final-video/v2 artifacts', async () => {
    const artifactId = await new RenderRepository(database.db).registerFinalArtifact({
      projectId: fixture.projectId,
      outputKey: 'exports/final-v2.mp4',
      contentHash: '9'.repeat(64),
      sizeBytes: 123,
    })
    const [row] = await database.db
      .select({ schemaVersion: artifacts.schemaVersion })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, TEST_WORKSPACE_ID),
          eq(artifacts.id, artifactId)
        )
      )

    expect(row?.schemaVersion).toBe('cvc.final-video/v2')
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
