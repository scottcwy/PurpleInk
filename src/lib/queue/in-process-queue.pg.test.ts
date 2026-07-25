import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { pipelineRuns, projects, taskAttempts, workspaces } from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import type { JobSnapshot } from './query'

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

describe('legacy in-process queue PG compatibility', () => {
  it('has no database side effect until enqueue and persists one run/attempt atomically', async () => {
    const { InProcessQueue } = await import('./in-process-queue')
    const queue = new InProcessQueue()
    expect(getDbMock).not.toHaveBeenCalled()
    const projectId = await seedProject()

    const attemptId = await queue.enqueue(
      'render-shot',
      { projectId, nodeId: projectId },
      { projectId, nodeId: projectId }
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
    const attemptId = await queue.enqueue(
      'director-stage',
      { stage: 'INGEST' },
      { projectId }
    )

    queue.start(1)
    try {
      const snapshot = await waitForStatus(
        () => getJobSnapshot(projectId, attemptId),
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
      expect(await getJobSnapshot(randomUUID(), attemptId)).toBeNull()
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
    const attemptId = await queue.enqueue('missing-handler', {}, { projectId })

    queue.start(1)
    try {
      const snapshot = await waitForStatus(
        () => getJobSnapshot(projectId, attemptId),
        'failed'
      )
      expect(snapshot?.error).toBe('no handler for kind: missing-handler')
    } finally {
      queue.stop()
    }
  })

  it('does not let an earlier foreign-workspace attempt starve the local queue', async () => {
    const [{ InProcessQueue }, { getJobSnapshot }] = await Promise.all([
      import('./in-process-queue'),
      import('./query'),
    ])
    const foreignAttemptId = await seedForeignQueuedAttempt()
    const projectId = await seedProject()
    const queue = new InProcessQueue()
    queue.register('director-stage', vi.fn(async () => undefined))
    const localAttemptId = await queue.enqueue(
      'director-stage',
      { stage: 'INGEST' },
      { projectId }
    )

    queue.start(1)
    try {
      await waitForStatus(
        () => getJobSnapshot(projectId, localAttemptId),
        'done'
      )
      const [foreign] = await database.db
        .select({ status: taskAttempts.status })
        .from(taskAttempts)
        .where(eq(taskAttempts.id, foreignAttemptId))
      expect(foreign?.status).toBe('queued')
    } finally {
      queue.stop()
    }
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

async function seedForeignQueuedAttempt(): Promise<string> {
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
  return attemptId
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
