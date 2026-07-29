import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { queueFingerprint } from '@/lib/queue/attempt-checkpoint'
import type { QueueAdapter } from '@/lib/queue'
import { enqueueWebsiteVideo } from './website-queue-handler'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '00000000-0000-4000-8000-000000000101'

vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => WORKSPACE_ID,
}))

let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'website-queue',
    name: 'Website queue',
  })
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
    title: '网站介绍',
    script: '',
    workflowKind: 'website',
    workflowVersion: 'website:1.0.0',
    exportSettings: { schemaVersion: 1 },
  })
})

afterAll(async () => {
  await database.close()
})

describe('website video enqueue idempotency', () => {
  it.each(['queued', 'running', 'succeeded'] as const)(
    'reuses an existing %s project attempt under the advisory lock',
    async (status) => {
      const existingId = await seedAttempt(status)
      const enqueue = vi.fn()
      const preflight = vi.fn()

      await expect(enqueueWebsiteVideo(
        { projectId: PROJECT_ID },
        adapter(enqueue),
        preflight,
        database.db,
      )).resolves.toBe(existingId)
      expect(preflight).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    },
  )

  it('does not reuse a failed attempt and enqueues a project-level replacement', async () => {
    await seedAttempt('failed')
    const replacementId = randomUUID()
    const enqueue = vi.fn(async () => replacementId)
    const preflight = vi.fn(async () => undefined)

    await expect(enqueueWebsiteVideo(
      { projectId: PROJECT_ID },
      adapter(enqueue),
      preflight,
      database.db,
    )).resolves.toBe(replacementId)
    expect(preflight).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledWith(
      'website-video',
      { projectId: PROJECT_ID },
      { projectId: PROJECT_ID },
    )
  })
})

async function seedAttempt(
  status: 'queued' | 'running' | 'succeeded' | 'failed',
): Promise<string> {
  const payload = { projectId: PROJECT_ID }
  const fingerprint = queueFingerprint('website-video', payload)
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId: PROJECT_ID,
    status: status === 'failed' ? 'failed' : status,
    workflowVersion: 'website:1.0.0',
    fingerprint,
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.website-video',
    entityType: 'project',
    entityId: PROJECT_ID,
    attemptNo: 1,
    status,
    fingerprint,
    checkpoint: { schemaVersion: 1, kind: 'website-video', payload },
  })
  return attemptId
}

function adapter(
  enqueue: QueueAdapter['enqueue'],
): QueueAdapter {
  return {
    enqueue,
    register: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}
