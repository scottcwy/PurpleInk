import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { ProviderRequestError } from '@/features/ai/provider-request-error'
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

/** sweepExpiredLeases 写入的可重试报文：TASK_INTERRUPTED，retryable=true。 */
const RETRYABLE_MESSAGE = '执行进程中断，租约过期自动回收'

describe('completeAttempt 自动重试', () => {
  it('可重试失败：原 attempt 置 superseded，同 run 追加退避后的新 attempt', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, { nodeStatus: 'failed' })

    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      RETRYABLE_MESSAGE
    )

    const original = await readAttempt(seeded.attemptId)
    expect(original.status).toBe('superseded')
    expect(original.failure).toMatchObject({
      schemaVersion: 2,
      code: 'TASK_INTERRUPTED',
    })
    expect(original.completedAt).not.toBeNull()

    const attempts = await readRunAttempts(seeded.runId)
    expect(attempts).toHaveLength(2)
    const retry = attempts[1]!
    expect(retry.attemptNo).toBe(2)
    expect(retry.status).toBe('queued')
    expect(retry.fingerprint).toBe(original.fingerprint)
    expect(retry.checkpoint).toMatchObject({
      ...original.checkpoint,
      queueMeta: { ordinaryAttemptNo: 2 },
    })
    expect(retry.leaseExpiresAt).toBeNull()
    expect(retry.startedAt).toBeNull()
    // 退避 backoffMs(1) = 10s ± 20%：visibleAt 由 DB 时钟写入，须与 DB now()
    // 比较（容器与主机时钟可能漂移数十秒），区间放宽容纳查询耗时。
    const dbNow = await readDbNowMs()
    expect(retry.visibleAt.getTime()).toBeGreaterThan(dbNow + 4_000)
    expect(retry.visibleAt.getTime()).toBeLessThan(dbNow + 20_000)

    // run 保持排队语义：自动重试不是终态，不得把 run 标 failed。
    const run = await readRun(seeded.runId)
    expect(run.status).toBe('queued')
    expect(run.completedAt).toBeNull()

    // 节点复位到 pending（持久化为 queued）：重试 attempt 领取后 handler
    // 才能走 pending -> running。
    expect((await readNode(seeded.nodeId)).status).toBe('queued')

    // 原 jobId 的轮询快照跟随最新 attempt，不因 superseded 抛错。
    const snapshot = await runInAuthContext(
      { workspaceId: LOCAL_WORKSPACE_ID, userId: 'test-user' },
      async () => {
        const { getJobSnapshot } = await import('./query')
        return getJobSnapshot(projectId, seeded.attemptId)
      }
    )
    expect(snapshot).toMatchObject({ status: 'pending', attempts: 2 })
  })

  it('退避期内 claim 领不到重试 attempt；visibleAt 到期后被领取执行', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const { InProcessQueue } = await import('./in-process-queue')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, { nodeStatus: 'failed' })
    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      RETRYABLE_MESSAGE
    )
    const retry = (await readRunAttempts(seeded.runId))[1]!

    const queue = new InProcessQueue()
    const handled = vi.fn(async () => {})
    queue.register('director-stage', handled)
    queue.start({ 'director-stage': 1 })
    try {
      // 退避未到期（约 10s）：600ms 内不得被领取。
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect((await readAttempt(retry.id)).status).toBe('queued')
      expect(handled).not.toHaveBeenCalled()

      // visibleAt 到期后可被领取并执行成功。
      await database.db
        .update(taskAttempts)
        .set({ visibleAt: new Date(Date.now() - 1_000) })
        .where(eq(taskAttempts.id, retry.id))
      await waitForAttemptStatus(retry.id, 'succeeded')
      expect(handled).toHaveBeenCalledTimes(1)
      expect((await readRun(seeded.runId)).status).toBe('succeeded')
    } finally {
      queue.stop()
    }
  })

  it('不可重试错误：attempt 与 run 直接置 failed，不追加新 attempt', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, { nodeStatus: 'failed' })

    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      '尚未配置 StepFun API Key'
    )

    const attempt = await readAttempt(seeded.attemptId)
    expect(attempt.status).toBe('failed')
    expect(attempt.completedAt).not.toBeNull()
    const run = await readRun(seeded.runId)
    expect(run.status).toBe('failed')
    expect(run.completedAt).not.toBeNull()
    expect(await readRunAttempts(seeded.runId)).toHaveLength(1)
    // 终态路径不碰节点：补偿由 handler/入队链负责。
    expect((await readNode(seeded.nodeId)).status).toBe('failed')
  })

  it('attemptNo 超过自动重试上限后即使报文可重试也终态化', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, {
      attemptNo: 3,
      nodeStatus: 'failed',
    })

    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      RETRYABLE_MESSAGE
    )

    expect((await readAttempt(seeded.attemptId)).status).toBe('failed')
    expect((await readRun(seeded.runId)).status).toBe('failed')
    expect(await readRunAttempts(seeded.runId)).toHaveLength(1)
  })

  it('429 自动延期且延期任务可以被明确取消', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const { cancelDeferredAttempt } = await import('./cancel-deferred')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, { nodeStatus: 'failed' })
    const retryAt = new Date(Date.now() + 30_000)
    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      new ProviderRequestError({
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        operation: '文本生成',
        funding: 'managed',
        httpStatus: 429,
        retryAt,
      })
    )
    const attempts = await readRunAttempts(seeded.runId)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({
      status: 'superseded',
      failure: {
        schemaVersion: 2,
        code: 'PROVIDER_RATE_LIMITED',
        recovery: 'auto_wait',
      },
    })
    expect(attempts[1]).toMatchObject({
      status: 'queued',
      checkpoint: {
        queueMeta: {
          ordinaryAttemptNo: 1,
        },
      },
    })
    expect(attempts[1]!.visibleAt.getTime()).toBeGreaterThanOrEqual(
      retryAt.getTime() - 1_000
    )
    const node = await readNode(seeded.nodeId)
    expect(node.status).toBe('queued')
    expect(node.data).toMatchObject({
      payload: {
        executionNotice: {
          code: 'PROVIDER_RATE_LIMITED',
          providerLabel: '阶跃星辰',
        },
      },
    })
    expect((await readRun(seeded.runId)).status).toBe('queued')

    const cancelledAttemptId = await cancelDeferredAttempt(database.db, {
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId,
      nodeId: seeded.nodeId,
    })
    expect(cancelledAttemptId).toBe(attempts[1]!.id)
    expect((await readAttempt(cancelledAttemptId)).status).toBe('cancelled')
    expect((await readRun(seeded.runId)).status).toBe('cancelled')
  })

  it('累计等待超过 15 分钟后才把 429 终态化', async () => {
    const { completeAttempt, MAX_PROVIDER_WAIT_MS } = await import('./attempt-completion')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, { nodeStatus: 'failed' })
    await database.db
      .update(taskAttempts)
      .set({
        checkpoint: {
          schemaVersion: 1,
          queueMeta: {
            ordinaryAttemptNo: 1,
            providerWaitStartedAt: new Date(
              Date.now() - MAX_PROVIDER_WAIT_MS - 1_000
            ).toISOString(),
          },
        },
      })
      .where(eq(taskAttempts.id, seeded.attemptId))
    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      new ProviderRequestError({
        providerId: 'stepfun',
        providerLabel: '阶跃星辰',
        operation: '文本生成',
        funding: 'managed',
        httpStatus: 429,
      })
    )
    expect(await readRunAttempts(seeded.runId)).toHaveLength(1)
    expect((await readAttempt(seeded.attemptId)).status).toBe('failed')
    expect((await readRun(seeded.runId)).status).toBe('failed')
  })

  it('租约回收后的迟到完成不覆盖终态，也不再排入自动重试', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, { nodeStatus: 'failed' })

    // 这里模拟 sweepExpiredLeases 已在另一个事务中完成的收尸写入。迟到的
    // handler 无论报告成功还是可重试失败，都只能成为 no-op；否则 attempt/run
    // 会和节点上的 TASK_INTERRUPTED 投影彼此矛盾。
    await database.db
      .update(taskAttempts)
      .set({
        status: 'failed',
        failure: { schemaVersion: 1, message: RETRYABLE_MESSAGE },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskAttempts.id, seeded.attemptId))
    await database.db
      .update(pipelineRuns)
      .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(pipelineRuns.id, seeded.runId))

    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'succeeded'
    )
    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'failed',
      RETRYABLE_MESSAGE
    )

    expect((await readAttempt(seeded.attemptId)).status).toBe('failed')
    expect((await readRun(seeded.runId)).status).toBe('failed')
    expect(await readRunAttempts(seeded.runId)).toHaveLength(1)
  })

  it('成功路径维持原语义：attempt 与 run 同置 succeeded', async () => {
    const { completeAttempt } = await import('./attempt-completion')
    const projectId = await seedProject()
    const seeded = await seedRunningNodeAttempt(projectId, {})

    await completeAttempt(
      database.db,
      LOCAL_WORKSPACE_ID,
      seeded.attemptId,
      'succeeded'
    )

    const attempt = await readAttempt(seeded.attemptId)
    expect(attempt.status).toBe('succeeded')
    expect(attempt.failure).toBeNull()
    expect(attempt.completedAt).not.toBeNull()
    expect((await readRun(seeded.runId)).status).toBe('succeeded')
    expect(await readRunAttempts(seeded.runId)).toHaveLength(1)
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
    title: '自动重试测试',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  return projectId
}

/** 种一条 running 的 director-stage attempt 及其节点与 running run。 */
async function seedRunningNodeAttempt(
  projectId: string,
  options: { attemptNo?: number; nodeStatus?: string }
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
    attemptNo: options.attemptNo ?? 1,
    status: 'running',
    fingerprint: 'f'.repeat(64),
    checkpoint: {
      schemaVersion: 1,
      kind: 'director-stage',
      payload: { projectId, nodeId, stage: 'INGEST' },
    },
    startedAt: new Date(),
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

async function readRunAttempts(runId: string) {
  return database.db
    .select()
    .from(taskAttempts)
    .where(
      and(
        eq(taskAttempts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(taskAttempts.runId, runId)
      )
    )
    .orderBy(asc(taskAttempts.attemptNo))
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

async function waitForAttemptStatus(attemptId: string, expected: string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const row = await readAttempt(attemptId)
    if (row.status === expected) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for attempt status: ${expected}`)
}

/** DB 时钟基准：visibleAt 等 DB 产生的时间只与它比较，不与主机时钟混用。 */
async function readDbNowMs(): Promise<number> {
  const [row] = await database.sql<{ now: string | Date }[]>`select now()`
  if (!row) throw new Error('select now() 未返回行')
  return new Date(row.now).getTime()
}
