import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  canvasEdges,
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
import { listDirectorFrontierCandidates } from './frontier-reconciliation'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000401'

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'frontier-reconcile',
    name: 'Frontier reconcile',
  })
})

afterAll(async () => {
  await database.close()
})

it('selects only an unattended ready DAG with no active attempt', async () => {
  const readyProjectId = await seedProject({ autopilot: true, downstreamStatus: 'idle' })
  const audioReadyProjectId = await seedProject({
    workflowKind: 'audio',
    autopilot: false,
    directorContinuationEnabled: true,
    downstreamStatus: 'idle',
  })
  await seedProject({
    workflowKind: 'audio',
    autopilot: true,
    directorContinuationEnabled: false,
    downstreamStatus: 'idle',
  })
  await seedProject({ autopilot: false, downstreamStatus: 'idle' })
  await seedProject({ autopilot: true, downstreamStatus: 'succeeded' })
  await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    activeAttempt: true,
  })

  const candidates = await listDirectorFrontierCandidates(database.db)
  expect(candidates).toHaveLength(2)
  expect(candidates).toEqual(expect.arrayContaining([
    { workspaceId: WORKSPACE_ID, projectId: readyProjectId },
    { workspaceId: WORKSPACE_ID, projectId: audioReadyProjectId },
  ]))
})

it('blocks an active current epoch but ignores an active attempt from an old epoch', async () => {
  await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    activeAttempt: true,
    activeAttemptEpoch: 'current',
  })
  const oldEpochProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    activeAttempt: true,
    activeAttemptEpoch: 'old',
  })

  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([
    { workspaceId: WORKSPACE_ID, projectId: oldEpochProjectId },
  ])
})

it('recovers a retryable failed frontier but leaves terminal failures blocked', async () => {
  const directorRetryableProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'failed',
    retryable: true,
    errorProjection: 'director',
  })
  const renderRetryableProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'failed',
    retryable: true,
    errorProjection: 'render',
  })
  await seedProject({
    autopilot: true,
    downstreamStatus: 'failed',
    retryable: false,
  })
  await seedProject({
    autopilot: true,
    downstreamStatus: 'failed',
    retryable: true,
    errorProjection: 'both-conflict',
  })
  await seedProject({
    autopilot: true,
    downstreamStatus: 'failed',
    errorProjection: 'director-missing-render-true',
  })
  await seedProject({
    autopilot: true,
    downstreamStatus: 'failed',
    errorProjection: 'director-string-true',
  })

  const candidates = await listDirectorFrontierCandidates(database.db)

  expect(candidates).toHaveLength(2)
  expect(candidates).toEqual(expect.arrayContaining([
    { workspaceId: WORKSPACE_ID, projectId: directorRetryableProjectId },
    { workspaceId: WORKSPACE_ID, projectId: renderRetryableProjectId },
  ]))
})

it('uses node activity instead of a stale project timestamp for the recovery window', async () => {
  const [clock] = await database.sql<{ now: string | Date }[]>`select now() as now`
  const now = new Date(clock!.now)
  const projectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 16 * 60 * 1_000),
    nodeUpdatedAt: new Date(now.getTime() - 60 * 1_000),
    attemptUpdatedAt: new Date(now.getTime() - 16 * 60 * 1_000),
  })

  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([
    { workspaceId: WORKSPACE_ID, projectId },
  ])
})

it('does not recover when only the project row is recent but node and attempt activity are old', async () => {
  const [clock] = await database.sql<{ now: string | Date }[]>`select now() as now`
  const now = new Date(clock!.now)
  await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 60 * 1_000),
    nodeUpdatedAt: new Date(now.getTime() - 16 * 60 * 1_000),
    attemptUpdatedAt: new Date(now.getTime() - 16 * 60 * 1_000),
  })

  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([])
})

it('orders the recovery scan by real node and attempt activity', async () => {
  const [clock] = await database.sql<{ now: string | Date }[]>`select now() as now`
  const now = new Date(clock!.now)
  const olderProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 30 * 1_000),
    nodeUpdatedAt: new Date(now.getTime() - 2 * 60 * 1_000),
    attemptUpdatedAt: new Date(now.getTime() - 3 * 60 * 1_000),
  })
  const latestProjectId = await seedProject({
    autopilot: true,
    downstreamStatus: 'idle',
    updatedAt: new Date(now.getTime() - 10 * 60 * 1_000),
    attemptUpdatedAt: new Date(now.getTime() - 60 * 1_000),
  })

  expect(olderProjectId).not.toBe(latestProjectId)
  await expect(listDirectorFrontierCandidates(database.db)).resolves.toEqual([
    { workspaceId: WORKSPACE_ID, projectId: latestProjectId },
    { workspaceId: WORKSPACE_ID, projectId: olderProjectId },
  ])
})

it('does not truncate a recoverable candidate behind sixteen newer frontiers', async () => {
  const [clock] = await database.sql<{ now: string | Date }[]>`select now() as now`
  const now = new Date(clock!.now)
  const projectIds: string[] = []
  for (let index = 0; index < 17; index += 1) {
    projectIds.push(await seedProject({
      autopilot: true,
      downstreamStatus: 'idle',
      nodeUpdatedAt: new Date(now.getTime() - index * 1_000),
      attemptUpdatedAt: new Date(now.getTime() - index * 1_000),
    }))
  }

  const candidates = await listDirectorFrontierCandidates(database.db)

  expect(candidates).toHaveLength(17)
  expect(candidates.map(({ projectId }) => projectId)).toContain(projectIds.at(-1))
})

async function seedProject(input: {
  autopilot: boolean
  workflowKind?: 'script' | 'audio'
  directorContinuationEnabled?: boolean
  downstreamStatus: 'idle' | 'succeeded' | 'failed'
  retryable?: boolean
  errorProjection?:
    | 'director'
    | 'render'
    | 'both-conflict'
    | 'director-missing-render-true'
    | 'director-string-true'
  activeAttempt?: boolean
  activeAttemptEpoch?: 'current' | 'old'
  updatedAt?: Date
  nodeUpdatedAt?: Date
  attemptUpdatedAt?: Date
}): Promise<string> {
  const projectId = randomUUID()
  const entryId = randomUUID()
  const downstreamId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '文稿项目',
    script: '真实文稿',
    workflowVersion: 'test',
    workflowKind: input.workflowKind ?? 'script',
    autopilot: input.autopilot,
    directorContinuationEnabled: input.directorContinuationEnabled ?? false,
    executionEpoch: input.activeAttemptEpoch === 'old' ? 1 : 0,
    exportSettings: { schemaVersion: 1 },
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  })
  await database.db.insert(canvasNodes).values([
    {
      workspaceId: WORKSPACE_ID,
      id: entryId,
      projectId,
      logicalKey: 'source:script',
      type: 'script-import',
      stage: 'INGEST',
      status: 'succeeded',
      data: { schemaVersion: 1, payload: {} },
      ...(input.nodeUpdatedAt ? { updatedAt: input.nodeUpdatedAt } : {}),
    },
    {
      workspaceId: WORKSPACE_ID,
      id: downstreamId,
      projectId,
      logicalKey: 'director:direct',
      type: 'shot-split',
      stage: 'DIRECT',
      status: input.downstreamStatus,
      data: {
        schemaVersion: 1,
        payload: input.downstreamStatus === 'failed'
          ? failurePayload(input)
          : {},
      },
      ...(input.nodeUpdatedAt ? { updatedAt: input.nodeUpdatedAt } : {}),
    },
  ])
  await database.db.insert(canvasEdges).values({
    workspaceId: WORKSPACE_ID,
    projectId,
    source: entryId,
    target: downstreamId,
  })
  const runId = randomUUID()
  await database.db.insert(pipelineRuns).values({
    workspaceId: WORKSPACE_ID,
    id: runId,
    projectId,
    executionEpoch: 0,
    status: input.activeAttempt ? 'queued' : 'succeeded',
    workflowVersion: 'test',
    fingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0'),
  })
  await database.db.insert(taskAttempts).values({
    workspaceId: WORKSPACE_ID,
    id: randomUUID(),
    runId,
    taskId: 'director-stage',
    entityType: 'node',
    entityId: entryId,
    attemptNo: 1,
    status: input.activeAttempt ? 'queued' : 'succeeded',
    fingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    checkpoint: { schemaVersion: 1 },
    ...(input.attemptUpdatedAt ? { updatedAt: input.attemptUpdatedAt } : {}),
  })
  return projectId
}

function failurePayload(input: {
  retryable?: boolean
  errorProjection?:
    | 'director'
    | 'render'
    | 'both-conflict'
    | 'director-missing-render-true'
    | 'director-string-true'
}): Record<string, unknown> {
  const error = {
    code: 'QUEUE_FAILED',
    message: '自动入队失败',
    retryable: input.retryable ?? false,
  }
  if (input.errorProjection === 'render') return { renderError: error }
  if (input.errorProjection === 'both-conflict') {
    return {
      directorError: { ...error, retryable: false },
      renderError: { ...error, retryable: true },
    }
  }
  if (input.errorProjection === 'director-missing-render-true') {
    const { retryable: _retryable, ...directorError } = error
    return {
      directorError,
      renderError: { ...error, retryable: true },
    }
  }
  if (input.errorProjection === 'director-string-true') {
    return {
      directorError: { ...error, retryable: 'true' },
    }
  }
  return { directorError: error }
}
