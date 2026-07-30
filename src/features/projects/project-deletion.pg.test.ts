import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'
import {
  aiInvocations,
  artifacts,
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workflowConcurrencyLeases,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { deleteProject } from './project-deletion'
import { ProjectDeleteBlockedError, ProjectNotFoundError } from './project-mutation-errors'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const RESERVED_MICROS = BigInt(1_000)
let database: PgTestDatabase

interface Seeded {
  projectId: string
  nodeId: string
  runId: string
  attemptId: string
  firstArtifactId: string
  secondArtifactId: string
  /** 挂在该项目 run 上的调用；随 run 级联消失。 */
  runScopedInvocationId: string
  /** 未挂 run / attempt 但引用了该项目产物的调用；必须存活且只被置空引用。 */
  detachedInvocationId: string
}

beforeAll(async () => {
  database = await createPgTestDatabase()
}, 60_000)

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'project-delete',
    name: 'Project Delete',
  })
})

afterAll(async () => {
  if (database) await database.close()
})

describe('deleteProject', () => {
  it('removes a project whose artifacts form a supersedes lineage', async () => {
    const seeded = await seedProject(database.db)

    const result = await deleteProject(seeded.projectId, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
      storage: { delete: async () => undefined },
    })

    expect(result).toMatchObject({
      projectId: seeded.projectId,
      deletedArtifacts: 2,
      removedStorageKeys: 2,
    })
    expect(await database.db.select().from(projects)).toHaveLength(0)
    expect(await database.db.select().from(artifacts)).toHaveLength(0)
    expect(await database.db.select().from(canvasNodes)).toHaveLength(0)
    expect(await database.db.select().from(pipelineRuns)).toHaveLength(0)
    expect(await database.db.select().from(taskAttempts)).toHaveLength(0)
  })

  it('clears artifact references on surviving AI invocations instead of deleting them', async () => {
    const seeded = await seedProject(database.db)

    await deleteProject(seeded.projectId, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
      storage: { delete: async () => undefined },
    })

    // 未挂在该项目 run / attempt 上的调用必须存活，只丢掉产物引用；
    // 计费金额字段保持原值。
    const [detached] = await database.db
      .select()
      .from(aiInvocations)
      .where(eq(aiInvocations.id, seeded.detachedInvocationId))
    expect(detached).toBeDefined()
    expect(detached?.traceArtifactId).toBeNull()
    expect(detached?.reservedCnyMicros).toBe(RESERVED_MICROS)

    // 挂在该项目 run 上的调用由既有 ai_invocations_run_fk CASCADE 收走，
    // 这是本任务之前就存在的 schema 设计，不由删除逻辑另行决定。
    const [runScoped] = await database.db
      .select()
      .from(aiInvocations)
      .where(eq(aiInvocations.id, seeded.runScopedInvocationId))
    expect(runScoped).toBeUndefined()
  })

  it('deletes the stored bytes of every artifact it removed', async () => {
    const seeded = await seedProject(database.db)
    const deleted: string[] = []

    await deleteProject(seeded.projectId, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
      storage: {
        delete: async (key) => {
          deleted.push(key)
        },
      },
    })

    expect(deleted.sort()).toEqual([
      'artifacts/shot-v1.html',
      'artifacts/shot-v2.html',
    ])
  })

  it('refuses to delete while an attempt is still in flight and leaves every row intact', async () => {
    const seeded = await seedProject(database.db, { attemptStatus: 'running' })

    await expect(
      deleteProject(seeded.projectId, {
        database: database.db,
        workspaceId: WORKSPACE_ID,
        storage: { delete: async () => undefined },
      }),
    ).rejects.toBeInstanceOf(ProjectDeleteBlockedError)

    expect(await database.db.select().from(projects)).toHaveLength(1)
    expect(await database.db.select().from(artifacts)).toHaveLength(2)
    expect(await database.db.select().from(canvasNodes)).toHaveLength(1)
  })

  it('refuses to delete while a concurrency lease is unreleased', async () => {
    const seeded = await seedProject(database.db)
    await database.db.insert(workflowConcurrencyLeases).values({
      workspaceId: WORKSPACE_ID,
      workUnitKey: 'shot:S001',
      projectId: seeded.projectId,
      planKey: 'free',
      status: 'active',
    })

    await expect(
      deleteProject(seeded.projectId, {
        database: database.db,
        workspaceId: WORKSPACE_ID,
        storage: { delete: async () => undefined },
      }),
    ).rejects.toBeInstanceOf(ProjectDeleteBlockedError)

    expect(await database.db.select().from(projects)).toHaveLength(1)
  })

  it('does not touch any other project in the same workspace', async () => {
    const target = await seedProject(database.db)
    const keeper = await seedProject(database.db)

    await deleteProject(target.projectId, {
      database: database.db,
      workspaceId: WORKSPACE_ID,
      storage: { delete: async () => undefined },
    })

    expect(await database.db.select().from(projects)).toHaveLength(1)
    expect(
      await database.db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.workspaceId, WORKSPACE_ID),
            eq(artifacts.projectId, keeper.projectId),
          ),
        ),
    ).toHaveLength(2)
    expect(await database.db.select().from(canvasNodes)).toHaveLength(1)
    // 另一个项目的产物引用必须原样保留，证明置空只作用于目标项目。
    const [keeperInvocation] = await database.db
      .select()
      .from(aiInvocations)
      .where(eq(aiInvocations.id, keeper.detachedInvocationId))
    expect(keeperInvocation?.traceArtifactId).toBe(keeper.firstArtifactId)
  })

  it('rejects an unknown project without writing', async () => {
    await expect(
      deleteProject(randomUUID(), {
        database: database.db,
        workspaceId: WORKSPACE_ID,
        storage: { delete: async () => undefined },
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError)
  })
})

/**
 * 播种一个「真实形状」的项目：节点 + run + attempt + 带 supersedes 谱系的两个产物
 * + 引用产物的 AI 调用。这三者正是级联链上三条 RESTRICT 外键的来源。
 */
async function seedProject(
  db: Db,
  options: { attemptStatus?: string } = {},
): Promise<Seeded> {
  const projectId = randomUUID()
  const nodeId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  const runScopedInvocationId = randomUUID()
  const detachedInvocationId = randomUUID()
  const suffix = projectId.slice(0, 8)

  await db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '待删除项目',
    script: '文稿',
    workflowVersion: 'delete-test-v1',
    exportSettings: { schemaVersion: 1, settings: { resolutionPreset: '1920x1080' } },
  })
  await db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: `shot:${suffix}:shot-codegen`,
    type: 'shot-codegen',
    stage: 'FABRICATE',
    status: 'succeeded',
    data: { schemaVersion: 1 },
  })
  await db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    status: 'succeeded',
    workflowVersion: 'delete-test-v1',
    fingerprint: 'a'.repeat(64),
  })
  await db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'delete.test',
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status: options.attemptStatus ?? 'succeeded',
    fingerprint: 'b'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })

  const firstArtifactId = randomUUID()
  const secondArtifactId = randomUUID()
  await db.insert(artifacts).values({
    workspaceId: WORKSPACE_ID,
    id: firstArtifactId,
    projectId,
    aggregateType: 'node',
    aggregateId: nodeId,
    kind: 'director-fabricate',
    version: 1,
    lifecycle: 'released',
    schemaVersion: 'cvc.delete-test/v1',
    storageKey: 'artifacts/shot-v1.html',
    sizeBytes: 10,
    contentHash: 'c'.repeat(64),
    attemptId,
  })
  // v2 supersedes v1：artifacts_supersedes_fk 是 RESTRICT 自引用，
  // 不先断链就无法在同一语句里删掉父子两行。
  await db.insert(artifacts).values({
    workspaceId: WORKSPACE_ID,
    id: secondArtifactId,
    projectId,
    aggregateType: 'node',
    aggregateId: nodeId,
    kind: 'director-fabricate',
    version: 2,
    lifecycle: 'approved',
    schemaVersion: 'cvc.delete-test/v1',
    storageKey: 'artifacts/shot-v2.html',
    sizeBytes: 12,
    contentHash: 'd'.repeat(64),
    attemptId,
    supersedesArtifactId: firstArtifactId,
  })
  // ai_invocations_trace_artifact_fk 是 RESTRICT。两行分别覆盖两种归属：
  // 挂 run 的会随既有 CASCADE 消失，未挂 run 的必须存活并被置空引用。
  await db.insert(aiInvocations).values([
    {
      workspaceId: WORKSPACE_ID,
      id: runScopedInvocationId,
      runId,
      attemptId,
      invocationNo: 1,
      status: 'succeeded',
      provider: 'stepfun',
      model: 'step-2',
      funding: 'managed',
      capability: 'text',
      billingStatus: 'settled',
      reservedCnyMicros: RESERVED_MICROS,
      traceArtifactId: secondArtifactId,
    },
    {
      workspaceId: WORKSPACE_ID,
      id: detachedInvocationId,
      invocationNo: 1,
      status: 'succeeded',
      provider: 'stepfun',
      model: 'step-2',
      funding: 'managed',
      capability: 'text',
      billingStatus: 'settled',
      reservedCnyMicros: RESERVED_MICROS,
      traceArtifactId: firstArtifactId,
    },
  ])

  return {
    projectId,
    nodeId,
    runId,
    attemptId,
    firstArtifactId,
    secondArtifactId,
    runScopedInvocationId,
    detachedInvocationId,
  }
}
