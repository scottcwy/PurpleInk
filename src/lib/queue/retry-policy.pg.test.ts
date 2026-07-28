import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => {
  await database.close()
})

const AUTH = { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' }

describe('countRecentFailures', () => {
  it('只统计窗口内 status=failed 且同 fingerprint 的 attempt', async () => {
    const { countRecentFailures, RETRY_WINDOW_MS } = await import('./retry-policy')
    const projectId = await seedProject()
    const fingerprint = 'a'.repeat(64)
    const other = 'b'.repeat(64)
    const now = new Date()
    const outsideWindow = new Date(Date.now() - RETRY_WINDOW_MS - 60_000)
    for (let index = 0; index < 3; index += 1) {
      await seedCompletedAttempt(projectId, { fingerprint, completedAt: now })
    }
    // 窗口外的旧失败与非 failed 状态、异 fingerprint 都不计入。
    await seedCompletedAttempt(projectId, { fingerprint, completedAt: outsideWindow })
    await seedCompletedAttempt(projectId, { fingerprint, completedAt: outsideWindow })
    await seedCompletedAttempt(projectId, {
      fingerprint,
      completedAt: now,
      status: 'succeeded',
    })
    await seedCompletedAttempt(projectId, { fingerprint: other, completedAt: now })

    await expect(
      countRecentFailures(database.db, LOCAL_WORKSPACE_ID, fingerprint)
    ).resolves.toBe(3)
  })
})

describe('enqueueDirectorStage 毒任务闸门', () => {
  it('窗口内 5 次失败拒绝入队并投影 RETRY_BUDGET_EXHAUSTED；窗口外旧失败不计入', async () => {
    const [
      { enqueueDirectorStage },
      { InProcessQueue },
      { assertEnqueueRetryBudget, MAX_FAILURES_IN_WINDOW, RETRY_WINDOW_MS },
      { queueFingerprint },
      { transitionNodeStatus },
      { DirectorRuntimeRepository },
      { storage },
    ] = await Promise.all([
      import('@/features/director/queue-handler'),
      import('./in-process-queue'),
      import('./retry-policy'),
      import('./attempt-checkpoint'),
      import('@/features/canvas/status'),
      import('@/features/director/runtime-repository'),
      import('@/lib/storage'),
    ])
    const projectId = await seedProject()
    const nodeId = await seedFailedNode(projectId)
    // 与 enqueue 相同的 zod 键序（projectId, nodeId, stage）计算目标 fingerprint。
    const fingerprint = queueFingerprint('director-stage', {
      projectId,
      nodeId,
      stage: 'INGEST',
    })
    for (let index = 0; index < MAX_FAILURES_IN_WINDOW; index += 1) {
      await seedCompletedAttempt(projectId, {
        fingerprint,
        completedAt: new Date(),
        entityId: nodeId,
      })
    }
    const repository = new DirectorRuntimeRepository(database.db, storage)
    const dependencies = {
      queue: new InProcessQueue(),
      assertEnqueueable: async () => {},
      transitionNodeStatus,
      recordStageError: (
        targetNodeId: string,
        stage: Parameters<typeof repository.recordStageError>[1],
        error: unknown
      ) => repository.recordStageError(targetNodeId, stage, error),
      assertRetryBudget: assertEnqueueRetryBudget,
    }
    const input = { projectId, nodeId, stage: 'INGEST' as const }

    await expect(
      runInAuthContext(AUTH, () => enqueueDirectorStage(input, dependencies))
    ).rejects.toThrow('已暂停重试')

    // 闸门只拦再次入队：不产生新 attempt，节点落 failed + 明确错误码。
    expect(await countAttempts(fingerprint)).toBe(MAX_FAILURES_IN_WINDOW)
    const node = await readNode(nodeId)
    expect(node.status).toBe('failed')
    expect(readDirectorError(node.data)).toMatchObject({
      code: 'RETRY_BUDGET_EXHAUSTED',
      retryable: false,
    })

    // 旧失败滑出 30 分钟窗口后，重试预算恢复，可再次入队。
    await database.db
      .update(taskAttempts)
      .set({ completedAt: new Date(Date.now() - RETRY_WINDOW_MS - 60_000) })
      .where(eq(taskAttempts.fingerprint, fingerprint))
    const attemptId = await runInAuthContext(AUTH, () =>
      enqueueDirectorStage(input, dependencies)
    )
    expect(attemptId).toBeTruthy()
    expect(await countAttempts(fingerprint)).toBe(MAX_FAILURES_IN_WINDOW + 1)
    // 重新入队后节点回到 pending（持久化为 queued）。
    expect((await readNode(nodeId)).status).toBe('queued')
  })
})

async function seedProject(): Promise<string> {
  const projectId = randomUUID()
  await database.db
    .insert(workspaces)
    .values({ id: LOCAL_WORKSPACE_ID, slug: 'local', name: 'Local workspace' })
    .onConflictDoNothing()
  await database.db.insert(projects).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: projectId,
    title: '重试预算测试',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  return projectId
}

async function seedFailedNode(projectId: string): Promise<string> {
  const nodeId = randomUUID()
  await database.db.insert(canvasNodes).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: `global:script-import-${nodeId}`,
    type: 'script-import',
    stage: 'INGEST',
    status: 'failed',
    data: { schemaVersion: 1, payload: {} },
  })
  return nodeId
}

/** 种一条已终态的 attempt（默认 failed）及其 run，用于预算窗口统计。 */
async function seedCompletedAttempt(
  projectId: string,
  options: {
    fingerprint: string
    completedAt: Date
    status?: string
    entityId?: string
  }
): Promise<void> {
  const status = options.status ?? 'failed'
  const runId = randomUUID()
  await database.db.insert(pipelineRuns).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: runId,
    projectId,
    status,
    workflowVersion: 'test',
    fingerprint: options.fingerprint,
    completedAt: options.completedAt,
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: randomUUID(),
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'node',
    entityId: options.entityId ?? randomUUID(),
    attemptNo: 1,
    status,
    fingerprint: options.fingerprint,
    checkpoint: { schemaVersion: 1, kind: 'director-stage', payload: {} },
    completedAt: options.completedAt,
  })
}

async function countAttempts(fingerprint: string): Promise<number> {
  const rows = await database.db
    .select({ id: taskAttempts.id })
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(taskAttempts.fingerprint, fingerprint)
      )
    )
  return rows.length
}

async function readNode(nodeId: string) {
  const [row] = await database.db
    .select()
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
        eq(canvasNodes.id, nodeId)
      )
    )
  if (!row) throw new Error(`节点不存在：${nodeId}`)
  return row
}

function readDirectorError(data: unknown): unknown {
  if (!data || typeof data !== 'object') return undefined
  const payload = (data as Record<string, unknown>).payload
  if (!payload || typeof payload !== 'object') return undefined
  return (payload as Record<string, unknown>).directorError
}
