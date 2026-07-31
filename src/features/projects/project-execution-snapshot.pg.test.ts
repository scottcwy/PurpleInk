import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
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
import { getProjectExecutionSnapshot } from './project-execution-snapshot'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000091'

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'execution-snapshot',
    name: 'Execution snapshot',
  })
})

afterAll(async () => {
  await database.close()
})

it('ignores an active attempt fenced by an older execution epoch', async () => {
  const fixture = await seedScriptExecution(0)

  const snapshot = await getProjectExecutionSnapshot(fixture.projectId, {
    database: database.db,
    workspaceId: WORKSPACE_ID,
  })

  expect(snapshot.state).toBe('recovering')
  expect(snapshot.attempt).toBeNull()
})

it('projects a current-epoch active attempt as queued', async () => {
  const fixture = await seedScriptExecution(1)

  const snapshot = await getProjectExecutionSnapshot(fixture.projectId, {
    database: database.db,
    workspaceId: WORKSPACE_ID,
  })

  expect(snapshot.state).toBe('queued')
  expect(snapshot).toMatchObject({
    schemaVersion: 2,
    projectKind: 'script',
    recovery: { canStart: false, canStop: true, mode: 'stop' },
    detail: { kind: 'script' },
  })
  expect(snapshot.attempt).toMatchObject({
    id: fixture.attemptId,
    status: 'queued',
  })
})

async function seedScriptExecution(runEpoch: number): Promise<{
  projectId: string
  attemptId: string
}> {
  const projectId = randomUUID()
  const nodeId = randomUUID()
  const runId = randomUUID()
  const attemptId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '执行快照测试',
    script: '真实文稿',
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1 },
    autopilot: true,
    executionEpoch: 1,
  })
  await database.db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id: nodeId,
    projectId,
    logicalKey: 'global:script-import',
    type: 'script-import',
    stage: 'INGEST',
    status: 'queued',
    data: { schemaVersion: 1, payload: {} },
  })
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    status: 'queued',
    executionEpoch: runEpoch,
    workflowVersion: 'test',
    fingerprint: 'a'.repeat(64),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: attemptId,
    runId,
    taskId: 'legacy.director-stage',
    entityType: 'node',
    entityId: nodeId,
    attemptNo: 1,
    status: 'queued',
    fingerprint: 'b'.repeat(64),
    checkpoint: { schemaVersion: 1 },
  })
  return { projectId, attemptId }
}
