import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentWorkspaceId,
  runInAuthContext,
} from '@/lib/auth/workspace-context'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { pipelineRuns, projects, taskAttempts, workspaces } from '@/lib/db/schema/index'
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

/** 模拟请求上下文：enqueue 与 getJobSnapshot 都要求已建立归属上下文。 */
function inWorkspace<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  return runInAuthContext({ workspaceId, userId: 'test-user' }, operation)
}

const inLocalWs = <T>(operation: () => Promise<T>) =>
  inWorkspace(LOCAL_WORKSPACE_ID, operation)

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

describe('legacy in-process queue PG compatibility', () => {
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

  it('executes a registered handler and exposes a workspace/project-safe snapshot', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    const handler = vi.fn(async () => undefined)
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
      queue.stop()
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
      expect(snapshot?.error).toBe('no handler for kind: missing-handler')
    } finally {
      queue.stop()
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
      queue.stop()
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
    const director = makeConcurrencyProbe()
    const render = makeConcurrencyProbe()
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
      queue.stop()
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
      queue.stop()
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
      queue.stop()
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
