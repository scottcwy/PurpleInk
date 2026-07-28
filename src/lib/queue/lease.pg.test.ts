import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('sweepExpiredLeases', () => {
  it('回收租约过期的 running attempt：attempt/run 置 failed，节点投影 TASK_INTERRUPTED', async () => {
    const { sweepExpiredLeases } = await import('./lease')
    const projectId = await seedProject()
    const expired = await seedRunningNodeAttempt(projectId, {
      leaseExpiresAt: new Date(Date.now() - 60_000),
    })
    const fresh = await seedRunningNodeAttempt(projectId, {
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })

    const swept = await sweepExpiredLeases(database.db)

    expect(swept).toEqual([expired.attemptId])
    const expiredAttempt = await readAttempt(expired.attemptId)
    expect(expiredAttempt).toMatchObject({
      status: 'failed',
      failure: { schemaVersion: 1, message: '执行进程中断，租约过期自动回收' },
    })
    expect(expiredAttempt.completedAt).not.toBeNull()
    expect((await readRun(expired.runId)).status).toBe('failed')

    const node = await readNode(expired.nodeId)
    expect(node.status).toBe('failed')
    expect(readDirectorError(node.data)).toMatchObject({
      code: 'TASK_INTERRUPTED',
      retryable: true,
      message: '执行进程中断，任务已自动回收。这是系统回收僵尸任务的保护机制，可放心重试',
    })

    // 未过期的 running attempt 完全不受影响。
    expect((await readAttempt(fresh.attemptId)).status).toBe('running')
    expect((await readRun(fresh.runId)).status).toBe('running')
    expect((await readNode(fresh.nodeId)).status).toBe('running')
  })

  it('节点已不在 running 时逐条容错：attempt 仍被回收，sweep 不崩溃', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { sweepExpiredLeases } = await import('./lease')
      const projectId = await seedProject()
      const expired = await seedRunningNodeAttempt(projectId, {
        leaseExpiresAt: new Date(Date.now() - 60_000),
        nodeStatus: 'succeeded',
      })

      await expect(sweepExpiredLeases(database.db)).resolves.toEqual([
        expired.attemptId,
      ])

      expect((await readAttempt(expired.attemptId)).status).toBe('failed')
      const node = await readNode(expired.nodeId)
      expect(node.status).toBe('succeeded')
      expect(readDirectorError(node.data)).toBeUndefined()
      expect(errorLog).toHaveBeenCalled()
    } finally {
      errorLog.mockRestore()
    }
  })
})

describe('renewLeases', () => {
  it('只续租传入的 attempt id，其余 running attempt 的租约不动', async () => {
    const { renewLeases } = await import('./lease')
    const projectId = await seedProject()
    const lease = new Date(Date.now() + 5_000)
    const renewed = await seedRunningNodeAttempt(projectId, { leaseExpiresAt: lease })
    const untouched = await seedRunningNodeAttempt(projectId, { leaseExpiresAt: lease })

    await renewLeases(database.db, [renewed.attemptId])

    const renewedAttempt = await readAttempt(renewed.attemptId)
    expect(renewedAttempt.leaseExpiresAt!.getTime()).toBeGreaterThan(
      lease.getTime() + 60_000
    )
    const untouchedAttempt = await readAttempt(untouched.attemptId)
    expect(untouchedAttempt.leaseExpiresAt!.getTime()).toBe(lease.getTime())

    // 空列表是心跳的常态（进程空闲），必须是无副作用的 no-op。
    await expect(renewLeases(database.db, [])).resolves.toBeUndefined()
  })
})

describe('claim 租约与 visibleAt 门', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('领取时写入租约；visibleAt 未到的 attempt 不被领取', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    queue.register('director-stage', async () => {
      await gate
    })

    const attemptId = await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' },
      () => queue.enqueue('director-stage', { stage: 'INGEST' }, { projectId })
    )
    // 先把 visibleAt 推到未来：claim 不得领取。
    await database.db
      .update(taskAttempts)
      .set({ visibleAt: new Date(Date.now() + 3_600_000) })
      .where(eq(taskAttempts.id, attemptId))

    queue.start({ 'director-stage': 1 })
    try {
      await new Promise((resolve) => setTimeout(resolve, 600))
      const invisible = await readAttempt(attemptId)
      expect(invisible.status).toBe('queued')
      expect(invisible.leaseExpiresAt).toBeNull()

      // visibleAt 到期后可被领取，领取瞬间必须带上租约。
      await database.db
        .update(taskAttempts)
        .set({ visibleAt: new Date(Date.now() - 1_000) })
        .where(eq(taskAttempts.id, attemptId))
      const running = await waitForAttemptStatus(attemptId, 'running')
      expect(running.leaseExpiresAt).not.toBeNull()
      expect(running.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now())

      release()
      await waitForAttemptStatus(attemptId, 'succeeded')
    } finally {
      release()
      queue.stop()
    }
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
    title: '租约测试',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  return projectId
}

/** 种一条 running 的 director-stage attempt 及其 running 节点与 run。 */
async function seedRunningNodeAttempt(
  projectId: string,
  options: { leaseExpiresAt: Date | null; nodeStatus?: string }
): Promise<{ nodeId: string; runId: string; attemptId: string }> {
  const nodeId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(canvasNodes).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: `global:script-import-${nodeId}`,
    type: 'script-import',
    stage: 'INGEST',
    status: options.nodeStatus ?? 'running',
    data: { schemaVersion: 1, payload: {} },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: runId,
    projectId,
    status: 'running',
    workflowVersion: 'test',
    fingerprint: 'f'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status: 'running',
    fingerprint: 'f'.repeat(64),
    checkpoint: {
      schemaVersion: 1,
      kind: 'director-stage',
      payload: { projectId, nodeId, stage: 'INGEST' },
    },
    startedAt: new Date(),
    leaseExpiresAt: options.leaseExpiresAt,
  })
  return { nodeId, runId, attemptId }
}

async function readAttempt(attemptId: string) {
  const [row] = await database.db
    .select()
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(taskAttempts.id, attemptId)
      )
    )
  if (!row) throw new Error(`attempt 不存在：${attemptId}`)
  return row
}

async function readRun(runId: string) {
  const [row] = await database.db
    .select()
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.workspaceId, LOCAL_WORKSPACE_ID),
        eq(pipelineRuns.id, runId)
      )
    )
  if (!row) throw new Error(`run 不存在：${runId}`)
  return row
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

async function waitForAttemptStatus(attemptId: string, expected: string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const row = await readAttempt(attemptId)
    if (row.status === expected) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for attempt status: ${expected}`)
}
