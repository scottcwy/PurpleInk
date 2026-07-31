import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  runInAuthContext,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import { stopProjectExecution } from '@/features/projects/project-execution-stop'
import { assertNodeExecutionFence } from '@/lib/db/transaction'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { withProjectResumeControl } from './resume-control'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000092'

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'resume-control',
    name: 'Resume control',
  })
})

afterAll(async () => {
  await database.close()
})

it('rejects a frontier candidate after stop closes the latch', async () => {
  const fixture = await seedAudioProject(false)
  const staleCandidate = { projectId: fixture.projectId }
  await stop(fixture.projectId)
  const enqueue = vi.fn(async () => 'job')

  const resumed = await inWorkspace(() =>
    withProjectResumeControl(
      staleCandidate.projectId,
      undefined,
      enqueue,
      database.db,
    ))

  expect(resumed).toBeNull()
  expect(enqueue).not.toHaveBeenCalled()
  const [project] = await database.db.select().from(projects)
  expect(project).toMatchObject({
    directorContinuationEnabled: false,
    executionEpoch: 1,
  })
})

it('rejects audio resume when stop lands after the final execution assertion', async () => {
  const fixture = await seedAudioProject(true)
  const fence = {
    projectId: fixture.projectId,
    attemptId: fixture.attemptId!,
  }
  await inWorkspace(() => database.db.transaction((transaction) =>
    assertNodeExecutionFence(
      transaction,
      { id: fixture.nodeId, projectId: fixture.projectId },
      fence,
    )))
  await stop(fixture.projectId)
  const enqueue = vi.fn(async () => 'job')

  const resumed = await inWorkspace(() =>
    withProjectResumeControl(
      fixture.projectId,
      { nodeId: fixture.nodeId, fence },
      enqueue,
      database.db,
    ))

  expect(resumed).toBeNull()
  expect(enqueue).not.toHaveBeenCalled()
  const [project] = await database.db.select().from(projects)
  expect(project).toMatchObject({
    directorContinuationEnabled: false,
    executionEpoch: 1,
  })
})

it('releases the project row before the resume operation opens its enqueue transaction', async () => {
  const fixture = await seedAudioProject(false)

  await expect(inWorkspace(() =>
    withProjectResumeControl(
      fixture.projectId,
      undefined,
      () => database.db.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '100ms'`)
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.workspaceId, WORKSPACE_ID),
            eq(projects.id, fixture.projectId),
          ))
          .limit(1)
          .for('update')
        return project?.id ?? null
      }),
      database.db,
    ))).resolves.toBe(fixture.projectId)
})

async function seedAudioProject(withRunningAttempt: boolean): Promise<{
  projectId: string
  nodeId: string
  attemptId?: string
}> {
  const projectId = randomUUID()
  const nodeId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '录音续接竞态测试',
    script: '真实转写',
    workflowKind: 'audio',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1 },
    autopilot: false,
    directorContinuationEnabled: true,
    executionEpoch: 0,
  })
  await database.db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: 'source:audio',
    type: 'audio-transcribe',
    stage: 'INGEST',
    status: withRunningAttempt ? 'running' : 'succeeded',
    data: { schemaVersion: 1, payload: {} },
  })
  if (!withRunningAttempt) return { projectId, nodeId }

  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    executionEpoch: 0,
    status: 'running',
    workflowVersion: 'test',
    fingerprint: 'a'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'audio-transcription',
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status: 'running',
    fingerprint: 'b'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
  return { projectId, nodeId, attemptId }
}

function stop(projectId: string): Promise<unknown> {
  return inWorkspace(() => stopProjectExecution(projectId, {
    database: database.db,
    finalizeInvocations: vi.fn(async () => []),
  }))
}

function inWorkspace<T>(operation: () => Promise<T>): Promise<T> {
  return runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: SYSTEM_USER_ID },
    operation,
  )
}
