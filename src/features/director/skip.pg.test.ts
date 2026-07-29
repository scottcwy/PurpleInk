import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  artifacts,
  canvasEdges,
  canvasNodes,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const { getDbMock, memoryFiles } = vi.hoisted(() => ({
  getDbMock: vi.fn<() => Promise<Db>>(),
  memoryFiles: new Map<string, Buffer>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  getDb: getDbMock,
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))
// 内存存储替身：保留 put/get 的真实字节语义，供「哈希取实际字节」断言。
vi.mock('@/lib/storage', () => ({
  storage: {
    put: async (key: string, data: Buffer | Uint8Array | string) => {
      memoryFiles.set(key, Buffer.from(data as Uint8Array))
      return key
    },
    get: async (key: string) => {
      const bytes = memoryFiles.get(key)
      if (!bytes) throw new Error(`存储键不存在：${key}`)
      return bytes
    },
    exists: async (key: string) => memoryFiles.has(key),
    delete: async (key: string) => {
      memoryFiles.delete(key)
    },
  },
}))
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => WORKSPACE_ID,
  currentUserId: () => 'test-user',
}))

import { skipNodeAction, SkipRejectedError } from './skip'
import { AdvanceRepositoryImpl } from './advance-repository'

describe('skipNodeAction（阶段 3：人为跳过）', () => {
  let database: PgTestDatabase
  let projectId: string

  beforeAll(async () => {
    database = await createPgTestDatabase()
  })

  beforeEach(async () => {
    await database.reset()
    memoryFiles.clear()
    projectId = randomUUID()
    getDbMock.mockResolvedValue(database.db)
    await seedProject(database.db, projectId)
  })

  afterAll(async () => {
    await database.close()
  })

  it('失败的 shot-sfx：登记 marker 产物（哈希=实际字节）、节点转 skipped、清旧错误、attempt 收敛', async () => {
    const nodeId = await insertNode(database.db, projectId, {
      type: 'shot-sfx',
      stage: 'ASSEMBLE',
      status: 'failed',
      payload: {
        laneKey: 'S001',
        directorError: { stage: 'ASSEMBLE', message: '上一次失败', retryable: true },
      },
    })

    const result = await skipNodeAction({
      projectId,
      nodeId,
      reason: '素材缺失，先用占位继续',
    })

    expect(result).toMatchObject({
      ok: true,
      action: 'skip',
      requestedNodeId: nodeId,
      queuedNodeId: nodeId,
    })

    // 节点：skipped + skipMeta 可审计 + 旧错误字段清除。
    const node = await readNode(database.db, nodeId)
    expect(node.status).toBe('skipped')
    const payload = (node.data as { payload: Record<string, unknown> }).payload
    expect(payload.skipMeta).toMatchObject({ reason: '素材缺失，先用占位继续' })
    expect(payload.skipMeta).toMatchObject({ kind: 'output-degradation' })
    expect(payload.directorError).toBeUndefined()
    expect(payload.laneKey).toBe('S001')

    // 产物：kind/storageKey 合同，contentHash 与 sizeBytes 取自实际落盘字节。
    const [artifact] = await database.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, WORKSPACE_ID),
          eq(artifacts.kind, 'node-skip-marker')
        )
      )
    expect(artifact).toBeDefined()
    expect(artifact!.aggregateId).toBe(nodeId)
    expect(artifact!.storageKey).toBe(`node-skip/${projectId}/${nodeId}.json`)
    const bytes = memoryFiles.get(artifact!.storageKey)
    expect(bytes).toBeDefined()
    expect(artifact!.sizeBytes).toBe(bytes!.byteLength)
    expect(artifact!.contentHash).toBe(
      createHash('sha256').update(bytes!).digest('hex')
    )
    const marker = JSON.parse(bytes!.toString('utf8')) as Record<string, unknown>
    expect(marker).toMatchObject({
      schemaVersion: 2,
      projectId,
      nodeId,
      nodeType: 'shot-sfx',
      skipKind: 'output-degradation',
      reason: '素材缺失，先用占位继续',
    })

    // attempt：跳过的承载 attempt 成功终态，jobId 即 attemptId。
    const [attempt] = await database.db
      .select({ status: taskAttempts.status, entityId: taskAttempts.entityId })
      .from(taskAttempts)
      .where(eq(taskAttempts.id, result.jobId))
    expect(attempt).toEqual({ status: 'succeeded', entityId: nodeId })
  })

  it('失败的 shot-qa 可被人工豁免，但明确保持未验收语义', async () => {
    const nodeId = await insertNode(database.db, projectId, {
      type: 'shot-qa',
      stage: 'FINALIZE',
      status: 'failed',
      payload: { laneKey: 'S004' },
    })

    const result = await skipNodeAction({
      projectId,
      nodeId,
      reason: '接受当前镜头未验收风险',
    })

    expect(result.message).toContain('未验收')
    expect(result.message).toContain('降级交付')
    const node = await readNode(database.db, nodeId)
    expect(node.status).toBe('skipped')
    const payload = (node.data as { payload: Record<string, unknown> }).payload
    expect(payload.skipMeta).toMatchObject({
      reason: '接受当前镜头未验收风险',
      kind: 'qa-waiver',
    })
    const marker = JSON.parse(
      [...memoryFiles.values()][0]!.toString('utf8')
    ) as Record<string, unknown>
    expect(marker).toMatchObject({
      schemaVersion: 2,
      nodeType: 'shot-qa',
      skipKind: 'qa-waiver',
    })
  })

  it('不可跳过的 score 被拒绝且节点与存储零变化', async () => {
    const nodeId = await insertNode(database.db, projectId, {
      type: 'score',
      stage: 'ASSEMBLE',
      status: 'failed',
    })

    await expect(
      skipNodeAction({ projectId, nodeId, reason: '不能跳过硬前置' })
    ).rejects.toBeInstanceOf(SkipRejectedError)
    expect((await readNode(database.db, nodeId)).status).toBe('failed')
    expect(memoryFiles.size).toBe(0)
  })

  it('running 状态不可跳过；空原因不可跳过', async () => {
    const runningId = await insertNode(database.db, projectId, {
      type: 'shot-sfx',
      stage: 'ASSEMBLE',
      status: 'running',
    })
    await expect(
      skipNodeAction({ projectId, nodeId: runningId, reason: '正在跑也想跳' })
    ).rejects.toBeInstanceOf(SkipRejectedError)

    const failedId = await insertNode(database.db, projectId, {
      type: 'shot-subtitle',
      stage: 'ASSEMBLE',
      status: 'failed',
    })
    await expect(
      skipNodeAction({ projectId, nodeId: failedId, reason: '   ' })
    ).rejects.toBeInstanceOf(SkipRejectedError)
  })

  it('skipped 上游解锁下游推进：areAllUpstreamsSuccessful / listCompletedNodeIds / isProjectComplete', async () => {
    const repository = new AdvanceRepositoryImpl(database.db)
    const upstreamSkipped = await insertNode(database.db, projectId, {
      type: 'shot-codegen',
      stage: 'FABRICATE',
      status: 'skipped',
    })
    const upstreamSucceeded = await insertNode(database.db, projectId, {
      type: 'shot-sfx',
      stage: 'ASSEMBLE',
      status: 'succeeded',
    })
    const downstream = await insertNode(database.db, projectId, {
      type: 'shot-qa',
      stage: 'FINALIZE',
      status: 'idle',
    })
    for (const source of [upstreamSkipped, upstreamSucceeded]) {
      await database.db.insert(canvasEdges).values({
        workspaceId: WORKSPACE_ID,
        id: randomUUID(),
        projectId,
        source,
        target: downstream,
      })
    }

    await expect(
      repository.areAllUpstreamsSuccessful(projectId, downstream)
    ).resolves.toBe(true)
    await expect(repository.listCompletedNodeIds(projectId)).resolves.toEqual(
      expect.arrayContaining([upstreamSkipped, upstreamSucceeded])
    )
    // downstream 还是 idle：项目未完成；downstream 成功后全项目视为完成。
    await expect(repository.isProjectComplete(projectId)).resolves.toBe(false)
    await database.db
      .update(canvasNodes)
      .set({ status: 'succeeded' })
      .where(eq(canvasNodes.id, downstream))
    await expect(repository.isProjectComplete(projectId)).resolves.toBe(true)
  })

  it('failed 上游不满足下游前置（skipped 不误伤既有语义）', async () => {
    const repository = new AdvanceRepositoryImpl(database.db)
    const failedUpstream = await insertNode(database.db, projectId, {
      type: 'shot-codegen',
      stage: 'FABRICATE',
      status: 'failed',
    })
    const downstream = await insertNode(database.db, projectId, {
      type: 'shot-qa',
      stage: 'FINALIZE',
      status: 'idle',
    })
    await database.db.insert(canvasEdges).values({
      workspaceId: WORKSPACE_ID,
      id: randomUUID(),
      projectId,
      source: failedUpstream,
      target: downstream,
    })

    await expect(
      repository.areAllUpstreamsSuccessful(projectId, downstream)
    ).resolves.toBe(false)
  })
})

async function seedProject(db: Db, projectId: string): Promise<void> {
  await db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: `workspace-${WORKSPACE_ID}`,
    name: 'Skip Test',
  })
  await db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '跳过机制测试',
    script: '',
    // 与 assertProjectWorkflowSupported 对齐：必须是当前受支持版本。
    workflowVersion: serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION),
    // autopilot 默认关闭：advancePipeline 提前返回，跳过流程本身不依赖队列。
    exportSettings: { schemaVersion: 1, settings: {} },
  })
}

async function insertNode(
  db: Db,
  projectId: string,
  input: {
    type: string
    stage: string
    status: string
    payload?: Record<string, unknown>
  }
): Promise<string> {
  const id = randomUUID()
  await db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id,
    projectId,
    logicalKey: `test:${id}`,
    type: input.type,
    stage: input.stage,
    data: { schemaVersion: 1, payload: input.payload ?? {} },
    status: input.status,
  })
  return id
}

async function readNode(
  db: Db,
  nodeId: string
): Promise<{ status: string; data: unknown }> {
  const [node] = await db
    .select({ status: canvasNodes.status, data: canvasNodes.data })
    .from(canvasNodes)
    .where(
      and(eq(canvasNodes.workspaceId, WORKSPACE_ID), eq(canvasNodes.id, nodeId))
    )
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  return node
}
