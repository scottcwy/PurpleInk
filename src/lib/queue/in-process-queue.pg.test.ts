import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentUserId,
  currentWorkspaceId,
  runInAuthContext,
} from '@/lib/auth/workspace-context'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  users,
  workflowConcurrencyLeases,
  workspaces,
} from '@/lib/db/schema/index'
import * as schema from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import type { JobSnapshot } from './query'
import type { JobHandler } from './types'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase
const TEST_USER_ID = '00000000-0000-4000-8000-000000000099'

/** 模拟请求上下文：enqueue 与 getJobSnapshot 都要求已建立归属上下文。 */
function inWorkspace<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  return runInAuthContext({ workspaceId, userId: TEST_USER_ID }, operation)
}

const inLocalWs = <T>(operation: () => Promise<T>) =>
  inWorkspace(LOCAL_WORKSPACE_ID, operation)

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(users).values({
    id: TEST_USER_ID,
    email: 'queue-user@example.test',
    name: 'Queue User',
    passwordHash: 'test-only-password-hash',
  })
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => {
  await database.close()
})

describe('legacy in-process queue PG compatibility', () => {
  it('does not exhaust a five-connection pool while polling four lanes and fallback', async () => {
    const client = postgres(process.env.TEST_DATABASE_URL!, { max: 5 })
    const poolDatabase = drizzle(client, { schema })
    let activeTransactions = 0
    let maxActiveTransactions = 0
    const observedDatabase = new Proxy(poolDatabase, {
      get(target, property, receiver) {
        if (property !== 'transaction') {
          return Reflect.get(target, property, receiver)
        }
        return async (
          operation: Parameters<typeof poolDatabase.transaction>[0],
        ) => target.transaction(async (transaction) => {
          activeTransactions += 1
          maxActiveTransactions = Math.max(
            maxActiveTransactions,
            activeTransactions,
          )
          try {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return await operation(transaction)
          } finally {
            activeTransactions -= 1
          }
        })
      },
    })
    getDbMock.mockResolvedValue(observedDatabase)
    const { InProcessQueue } = await import('./in-process-queue')
    const queue = new InProcessQueue()
    const internal = queue as unknown as {
      lanes: Record<string, number>
      tick: () => Promise<void>
    }
    internal.lanes = {
      'director-stage': 1,
      'render-shot': 1,
      'export-project': 1,
      'media-narration': 1,
    }

    try {
      await expect(Promise.race([
        internal.tick(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('queue polling exhausted the database pool')),
            1_000,
          )
        }),
      ])).resolves.toBeUndefined()
      expect(maxActiveTransactions).toBe(1)
    } finally {
      await client.end({ timeout: 1 })
      getDbMock.mockResolvedValue(database.db)
    }
  })

  it('does not overlap polling ticks when one claim cycle is slow', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const queue = new InProcessQueue()
    let releaseTick: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      releaseTick = resolve
    })
    let activeTicks = 0
    let maxActiveTicks = 0
    const tickSpy = vi
      .spyOn(
        queue as unknown as { tick: () => Promise<void> },
        'tick',
      )
      .mockImplementation(async () => {
        activeTicks += 1
        maxActiveTicks = Math.max(maxActiveTicks, activeTicks)
        await gate
        activeTicks -= 1
      })

    queue.start({ 'director-stage': 1 })
    try {
      await new Promise((resolve) => setTimeout(resolve, 550))
      expect(tickSpy).toHaveBeenCalledTimes(1)
      expect(maxActiveTicks).toBe(1)
    } finally {
      releaseTick()
      await queue.stopAndDrain()
    }
  })

  it('has no database side effect until enqueue and persists one run/attempt atomically', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const queue = new InProcessQueue()
    expect(getDbMock).not.toHaveBeenCalled()
    const projectId = await seedProject()

    const attemptId = await inLocalWs(() =>
      queue.enqueue(
        'render-shot',
        { projectId, nodeId: projectId },
        { projectId, nodeId: projectId }
      )
    )

    expect(getDbMock).toHaveBeenCalledOnce()
    const runs = await database.db.select().from(pipelineRuns)
    const attempts = await database.db.select().from(taskAttempts)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.requestedByUserId).toBe(TEST_USER_ID)
    expect(attempts).toMatchObject([
      {
        id: attemptId,
        runId: runs[0]!.id,
        taskId: 'legacy.render-shot',
        entityType: 'node',
        entityId: projectId,
        status: 'queued',
      },
    ])
  })

  it('persists a trusted project-family workflow version on the real run', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const projectId = await seedProject()
    const queue = new InProcessQueue()

    await inLocalWs(() =>
      queue.enqueue(
        'website-video',
        { projectId, workflowVersion: 'purpleink-website-intro-video-v1' },
        {
          projectId,
          workflowVersion: 'purpleink-website-intro-video-v1',
        },
      ),
    )

    const [run] = await database.db.select().from(pipelineRuns)
    expect(run?.workflowVersion).toBe('purpleink-website-intro-video-v1')
  })

  it('executes a registered handler and exposes a workspace/project-safe snapshot', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    const handler = vi.fn(async () => {
      expect(currentUserId()).toBe(TEST_USER_ID)
    })
    queue.register('director-stage', handler)
    const attemptId = await inLocalWs(() =>
      queue.enqueue('director-stage', { stage: 'INGEST' }, { projectId })
    )

    queue.start({ 'director-stage': 1 })
    try {
      const snapshot = await waitForStatus(
        () => inLocalWs(() => getJobSnapshot(projectId, attemptId)),
        'done'
      )
      expect(snapshot).toMatchObject({
        id: attemptId,
        projectId,
        nodeId: null,
        kind: 'director-stage',
        status: 'done',
        attempts: 1,
        error: null,
      })
      expect(handler).toHaveBeenCalledOnce()
      expect(
        await inLocalWs(() => getJobSnapshot(randomUUID(), attemptId))
      ).toBeNull()
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('records a stable failure when no handler is registered', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    const attemptId = await inLocalWs(() =>
      queue.enqueue('missing-handler', {}, { projectId })
    )

    queue.start()
    try {
      const snapshot = await waitForStatus(
        () => inLocalWs(() => getJobSnapshot(projectId, attemptId)),
        'failed'
      )
      expect(snapshot?.error).toBe('上游产物缺失或不包含当前镜头，需要先修复上游阶段。')
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('executes attempts from every workspace, each inside its own workspace context', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const foreign = await seedForeignQueuedAttempt()
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    // handler 在执行期记录当前上下文的 workspaceId，验证队列按 attempt 行建立归属。
    const seenWorkspaceIds: string[] = []
    queue.register(
      'director-stage',
      vi.fn(async () => {
        seenWorkspaceIds.push(currentWorkspaceId())
      })
    )
    const localAttemptId = await inLocalWs(() =>
      queue.enqueue('director-stage', { stage: 'INGEST' }, { projectId })
    )

    queue.start({ 'director-stage': 1 })
    try {
      await waitForStatus(
        () => inLocalWs(() => getJobSnapshot(projectId, localAttemptId)),
        'done'
      )
      const [foreignRow] = await waitForForeignCompletion(foreign.attemptId)
      expect(foreignRow?.status).toBe('succeeded')
      expect(seenWorkspaceIds).toEqual(
        expect.arrayContaining([LOCAL_WORKSPACE_ID, foreign.workspaceId])
      )
      // jobId 查询不能跨 workspace 命中：本地上下文查外部 attempt 必须落空。
      expect(
        await inLocalWs(() => getJobSnapshot(foreign.projectId, foreign.attemptId))
      ).toBeNull()
      expect(
        await inWorkspace(foreign.workspaceId, () =>
          getJobSnapshot(foreign.projectId, foreign.attemptId)
        )
      ).toMatchObject({ id: foreign.attemptId, status: 'done' })
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('rejects enqueue outside of an auth context instead of falling back to a constant', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    await expect(
      queue.enqueue('director-stage', { stage: 'INGEST' }, { projectId })
    ).rejects.toThrow(/workspace context is not established/)
  })

  it('enforces independent quotas per kind so one lane cannot starve or overrun the other', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    // 领取一次 PG attempt 在低性能 CI 上可能超过 40ms；留足窗口验证通道配额，
    // 避免把数据库延迟误判为队列只允许单并发。
    const director = makeConcurrencyProbe(250)
    const render = makeConcurrencyProbe(250)
    queue.register('director-stage', director.handler)
    queue.register('render-shot', render.handler)

    const directorIds = await Promise.all(
      Array.from({ length: 4 }, () =>
        inLocalWs(() =>
          queue.enqueue('director-stage', { stage: 'INGEST' }, { projectId })
        )
      )
    )
    const renderIds = await Promise.all(
      Array.from({ length: 4 }, () =>
        inLocalWs(() => queue.enqueue('render-shot', {}, { projectId }))
      )
    )

    queue.start({ 'director-stage': 2, 'render-shot': 1 })
    try {
      await waitForAllStatuses(
        (id) => inLocalWs(() => getJobSnapshot(projectId, id)),
        [...directorIds, ...renderIds],
        'done'
      )
      expect(director.state.max).toBe(2)
      expect(render.state.max).toBe(1)
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('isolates audio and website jobs from the fallback lane used by the main workflow', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    const started = new Set<string>()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    for (const kind of [
      'audio-transcription',
      'website-video',
      'media-narration',
    ]) {
      queue.register(kind, async () => {
        started.add(kind)
        await gate
      })
    }
    const ids = await Promise.all(
      ['audio-transcription', 'website-video', 'media-narration'].map((kind) =>
        inLocalWs(() => queue.enqueue(kind, {}, { projectId })),
      ),
    )

    queue.start()
    try {
      for (let attempt = 0; attempt < 100 && started.size < 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect([...started].sort()).toEqual([
        'audio-transcription',
        'media-narration',
        'website-video',
      ])
    } finally {
      release()
      await waitForAllStatuses(
        (id) => inLocalWs(() => getJobSnapshot(projectId, id)),
        ids,
        'done',
      )
      await queue.stopAndDrain()
    }
  })

  it('gates shot jobs by the workspace Free cap even when the process lane is larger', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const projectId = await seedProject()
    const nodeIds = Array.from({ length: 5 }, () => randomUUID())
    await database.db.insert(canvasNodes).values(nodeIds.map((id, index) => ({
      workspaceId: LOCAL_WORKSPACE_ID,
      id,
      projectId,
      logicalKey: `shot:queue-${index}:shot-script`,
      type: 'shot-script',
      stage: 'SHOT_SPEC',
      status: 'queued',
      data: {
        schemaVersion: 1,
        payload: { laneKey: `queue-${index}`, laneRole: 'shot-script' },
      },
    })))
    const queue = new InProcessQueue()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = vi.fn(async () => gate)
    queue.register('director-stage', handler)
    await Promise.all(nodeIds.map((nodeId) => inLocalWs(() =>
      queue.enqueue(
        'director-stage',
        { projectId, nodeId, stage: 'SHOT_SPEC' },
        { projectId, nodeId },
      )
    )))

    queue.start({ 'director-stage': 12 })
    try {
      await waitForCallCount(handler, 3)
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(handler).toHaveBeenCalledTimes(3)
      const leases = await database.db.select().from(workflowConcurrencyLeases)
      expect(leases.filter((lease) => lease.status === 'active')).toHaveLength(3)
      expect(leases.filter((lease) => lease.status === 'waiting').length)
        .toBeGreaterThanOrEqual(1)
      const queuedNodes = await database.db.select().from(canvasNodes)
      expect(queuedNodes.some((node) => {
        const payload = (node.data as { payload?: Record<string, unknown> }).payload
        const notice = payload?.executionNotice as Record<string, unknown> | undefined
        return notice?.code === 'PLAN_CONCURRENCY_WAIT'
          && notice.limit === 3
          && typeof notice.waiting === 'number'
      })).toBe(true)
    } finally {
      release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await queue.stopAndDrain()
    }
  })

  it('admits a runnable lane behind attempts whose lease order is inverted', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const projectId = await seedProject()
    const nodeIds = Array.from({ length: 7 }, () => randomUUID())
    const started: string[] = []
    await database.db.insert(canvasNodes).values(nodeIds.map((id, index) => ({
      workspaceId: LOCAL_WORKSPACE_ID,
      id,
      projectId,
      logicalKey: `shot:inverted-${index}:shot-script`,
      type: 'shot-script',
      stage: 'SHOT_SPEC',
      status: 'queued',
      data: {
        schemaVersion: 1,
        payload: { laneKey: `inverted-${index}`, laneRole: 'shot-script' },
      },
    })))
    const now = new Date()
    await database.db.insert(workflowConcurrencyLeases).values(
      nodeIds.map((_, index) => ({
        workspaceId: LOCAL_WORKSPACE_ID,
        projectId,
        workUnitKey: `inverted-${index}`,
        actorUserId: TEST_USER_ID,
        planKey: 'free',
        requestedAt: new Date(now.getTime() + (index === 6 ? -10_000 : index)),
        notBefore: new Date(now.getTime() - 1_000),
      })),
    )
    const queue = new InProcessQueue()
    queue.register('director-stage', async (job) => {
      started.push(String(job.payload.nodeId))
    })
    await Promise.all(nodeIds.map((nodeId) => inLocalWs(() =>
      queue.enqueue(
        'director-stage',
        { projectId, nodeId, stage: 'SHOT_SPEC' },
        { projectId, nodeId },
      )
    )))

    queue.start({ 'director-stage': 1 })
    try {
      for (let attempt = 0; attempt < 50 && started.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(started[0]).toBe(nodeIds[0])
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('does not let a render-shot job at the queue head block director-stage behind it (head-of-line regression)', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()

    let releaseRender: () => void = () => {}
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve
    })
    queue.register(
      'render-shot',
      vi.fn(async () => {
        await renderGate
      })
    )
    queue.register('director-stage', vi.fn(async () => undefined))

    // render-shot 先入队，是队列里最老的一条；若并发仍是单一全局计数器，
    // 它会一直占着唯一的槽位，后面的 director-stage 永远拿不到 claim() 的机会。
    const renderAttemptId = await inLocalWs(() =>
      queue.enqueue('render-shot', {}, { projectId })
    )
    const directorAttemptId = await inLocalWs(() =>
      queue.enqueue('director-stage', { stage: 'INGEST' }, { projectId })
    )

    queue.start({ 'render-shot': 1, 'director-stage': 1 })
    try {
      const directorSnapshot = await waitForStatus(
        () => inLocalWs(() => getJobSnapshot(projectId, directorAttemptId)),
        'done'
      )
      expect(directorSnapshot.status).toBe('done')
      const renderSnapshot = await inLocalWs(() =>
        getJobSnapshot(projectId, renderAttemptId)
      )
      expect(renderSnapshot?.status).toBe('running')
      releaseRender()
      await waitForStatus(
        () => inLocalWs(() => getJobSnapshot(projectId, renderAttemptId)),
        'done'
      )
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('caps concurrency at 1 for a kind that has no explicit lane quota', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    const probe = makeConcurrencyProbe()
    queue.register('custom-kind', probe.handler)

    const ids = await Promise.all(
      Array.from({ length: 3 }, () =>
        inLocalWs(() => queue.enqueue('custom-kind', {}, { projectId }))
      )
    )

    queue.start()
    try {
      await waitForAllStatuses(
        (id) => inLocalWs(() => getJobSnapshot(projectId, id)),
        ids,
        'done'
      )
      expect(probe.state.max).toBe(1)
    } finally {
      await queue.stopAndDrain()
    }
  })

  it('rejects non-positive or non-integer lane quotas before starting', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const queue = new InProcessQueue()
    expect(() => queue.start({ 'director-stage': 0 })).toThrow()
    expect(() => queue.start({ 'render-shot': -1 })).toThrow()
    expect(() => queue.start({ 'director-stage': 1.5 })).toThrow()
  })
})

async function seedProject(): Promise<string> {
  const projectId = randomUUID()
  await database.db
    .insert(workspaces)
    .values({
      id: LOCAL_WORKSPACE_ID,
      slug: 'local',
      name: 'Local workspace',
    })
    .onConflictDoNothing()
  await database.db.insert(projects).values({
    workspaceId: LOCAL_WORKSPACE_ID,
    id: projectId,
    title: '队列测试',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  return projectId
}

async function seedForeignQueuedAttempt(): Promise<{
  workspaceId: string
  projectId: string
  attemptId: string
}> {
  const workspaceId = '00000000-0000-4000-8000-000000000002'
  const projectId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(workspaces).values({
    id: workspaceId,
    slug: 'foreign',
    name: 'Foreign workspace',
  })
  await database.db.insert(projects).values({
    workspaceId,
    id: projectId,
    title: '外部工作区队列',
    script: '',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1, settings: {} },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId,
    id: runId,
    projectId,
    status: 'queued',
    workflowVersion: 'test',
    fingerprint: 'f'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId,
    id: attemptId,
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'project',
    entityId: projectId,
    attemptNo: 1,
    status: 'queued',
    fingerprint: 'f'.repeat(64),
    checkpoint: {
      schemaVersion: 1,
      kind: 'director-stage',
      payload: { stage: 'INGEST' },
    },
  })
  return { workspaceId, projectId, attemptId }
}

/** 直读 attempt 行等待外部 workspace 作业完成（不走受上下文限制的 getJobSnapshot）。 */
async function waitForForeignCompletion(
  attemptId: string
): Promise<Array<{ status: string }>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await database.db
      .select({ status: taskAttempts.status })
      .from(taskAttempts)
      .where(eq(taskAttempts.id, attemptId))
    if (rows[0] && rows[0].status !== 'queued' && rows[0].status !== 'running') {
      return rows
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('timed out waiting for foreign workspace attempt completion')
}

async function waitForStatus(
  read: () => Promise<JobSnapshot | null>,
  expected: 'done' | 'failed'
): Promise<JobSnapshot> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await read()
    if (snapshot?.status === expected) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for queue status: ${expected}`)
}

async function waitForAllStatuses(
  read: (id: string) => Promise<JobSnapshot | null>,
  ids: string[],
  expected: 'done' | 'failed'
): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const snapshots = await Promise.all(ids.map((id) => read(id)))
    if (snapshots.every((snapshot) => snapshot?.status === expected)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(
    `timed out waiting for ${ids.length} jobs to reach status: ${expected}`
  )
}

function makeConcurrencyProbe(delayMs = 40): {
  handler: JobHandler
  state: { current: number; max: number }
} {
  const state = { current: 0, max: 0 }
  const handler: JobHandler = vi.fn(async () => {
    state.current += 1
    state.max = Math.max(state.max, state.current)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    state.current -= 1
  })
  return { handler, state }
}

async function waitForCallCount(
  handler: ReturnType<typeof vi.fn>,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (handler.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${count} handler calls`)
}
