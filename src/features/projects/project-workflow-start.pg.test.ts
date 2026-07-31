import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { transitionNodeStatus } from '@/features/canvas'
import { AdvanceRepositoryImpl } from '@/features/director/advance-repository'
import { startProjectPipeline } from '@/features/director/advance'
import { enqueueDirectorStageWithReceipt } from '@/features/director/queue-handler'
import { withProjectResumeControl } from '@/features/director/resume-control'
import { DirectorRuntimeRepository } from '@/features/director/runtime-repository'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  canvasNodes,
  pipelineRuns,
  projects,
  taskAttempts,
  users,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { InProcessQueue } from '@/lib/queue/in-process-queue'
import { storage } from '@/lib/storage'
import { createProjectWithSource } from './project-creation'
import { stopProjectExecution } from './project-execution-stop'
import {
  loadProjectWorkflowStartDescriptor,
  ProjectWorkflowStartError,
  startProjectWorkflow,
  type ProjectWorkflowStartDependencies,
} from './project-workflow-start'

vi.mock('server-only', () => ({}))

const getDb = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/client')>()),
  getDb,
}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000002'
const FOREIGN_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003'
let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
}, 60_000)

beforeEach(async () => {
  await database.reset()
  getDb.mockResolvedValue(database.db)
  await database.db.insert(users).values({
    id: USER_ID,
    email: 'workflow-start@example.test',
    name: 'Workflow Start',
    passwordHash: 'test-only',
  })
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'workflow-start',
    name: 'Workflow Start',
  })
})

afterAll(async () => {
  await database.close()
})

describe('loadProjectWorkflowStartDescriptor', () => {
  it('binds kind, active version and explicit entry to the current workspace project', async () => {
    const created = await createAudioProject()

    await expect(loadDescriptor(created.project.id)).resolves.toEqual({
      kind: 'audio',
      workflowVersion: activeWorkflowVersionFor('audio'),
      entryNodeId: created.entryNodeId,
    })
  })

  it('keeps an active pre-project_sources script on the established main workflow', async () => {
    const seeded = await seedPreSourceScript(activeWorkflowVersionFor('script'))

    await expect(loadDescriptor(seeded.projectId)).resolves.toEqual({
      kind: 'script',
      workflowVersion: activeWorkflowVersionFor('script'),
      entryNodeId: seeded.entryNodeId,
    })
  })

  it('reports a legacy pre-project_sources script as unsupported instead of missing', async () => {
    const seeded = await seedPreSourceScript('legacy-script-workflow')

    await expect(loadDescriptor(seeded.projectId)).rejects.toMatchObject({
      code: 'PROJECT_WORKFLOW_VERSION_UNSUPPORTED',
      statusCode: 409,
    } satisfies Partial<ProjectWorkflowStartError>)
  })

  it('rejects a legacy version before any queue dispatch', async () => {
    const created = await createAudioProject()
    await database.db
      .update(projects)
      .set({ workflowVersion: 'purpleink-audio-to-video-legacy' })
      .where(eq(projects.id, created.project.id))

    await expect(loadDescriptor(created.project.id)).rejects.toMatchObject({
      code: 'PROJECT_WORKFLOW_VERSION_UNSUPPORTED',
      statusCode: 409,
    } satisfies Partial<ProjectWorkflowStartError>)
  })

  it('keeps missing and foreign workspace projects behind the same 404 boundary', async () => {
    await expect(loadDescriptor(randomUUID())).rejects.toMatchObject({
      code: 'PROJECT_WORKFLOW_NOT_FOUND',
      statusCode: 404,
    } satisfies Partial<ProjectWorkflowStartError>)
    await database.db.insert(workspaces).values({
      id: FOREIGN_WORKSPACE_ID,
      slug: 'workflow-start-foreign',
      name: 'Foreign Workflow Start',
    })
    const foreign = await createAudioProject(FOREIGN_WORKSPACE_ID)
    await expect(loadDescriptor(foreign.project.id)).rejects.toMatchObject({
      code: 'PROJECT_WORKFLOW_NOT_FOUND',
      statusCode: 404,
    } satisfies Partial<ProjectWorkflowStartError>)
  })
})

describe('script start persistence', () => {
  it('returns within a bound and persists one consistent node, run and attempt', async () => {
    const created = await createScriptProject()
    const queue = new InProcessQueue()

    const result = await withTimeout(startWorkflow(created.project.id, queue))

    expect(result).toMatchObject({
      kind: 'script',
      status: 'started',
      attemptStatus: 'queued',
      reused: false,
    })
    const [node] = await database.db
      .select({ status: canvasNodes.status })
      .from(canvasNodes)
      .where(eq(canvasNodes.id, created.entryNodeId))
    const runs = await database.db
      .select({ id: pipelineRuns.id, status: pipelineRuns.status })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.projectId, created.project.id))
    const attempts = await database.db
      .select({
        id: taskAttempts.id,
        runId: taskAttempts.runId,
        status: taskAttempts.status,
      })
      .from(taskAttempts)

    expect(node?.status).toBe('queued')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('queued')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      runId: runs[0]?.id,
      status: 'queued',
    })
    const idleTransactions = await database.sql`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and state = 'idle in transaction'
    `
    expect(idleTransactions[0]?.count).toBe(0)
  })

  it('concurrent starts share the real active attempt and report one reuse', async () => {
    const created = await createScriptProject()
    const queue = new InProcessQueue()

    const results = await withTimeout(Promise.all([
      startWorkflow(created.project.id, queue),
      startWorkflow(created.project.id, queue),
    ]))

    expect(results.map((result) => result.status).sort()).toEqual([
      'reused',
      'started',
    ])
    expect(new Set(results.map((result) => result.jobId)).size).toBe(1)
    const attempts = await database.db
      .select({ id: taskAttempts.id })
      .from(taskAttempts)
    expect(attempts).toHaveLength(1)
  })

  it('a stop after start cancels the committed attempt and advances the epoch', async () => {
    const created = await createScriptProject()
    const queue = new InProcessQueue()
    await startWorkflow(created.project.id, queue)

    await runInAuthContext(
      { workspaceId: WORKSPACE_ID, userId: USER_ID },
      () => stopProjectExecution(created.project.id, {
        database: database.db,
        releaseReservation: vi.fn(async () => undefined),
      }),
    )

    const [project] = await database.db
      .select({
        autopilot: projects.autopilot,
        executionEpoch: projects.executionEpoch,
      })
      .from(projects)
      .where(eq(projects.id, created.project.id))
    const [attempt] = await database.db
      .select({ status: taskAttempts.status })
      .from(taskAttempts)
    expect(project).toEqual({ autopilot: false, executionEpoch: 1 })
    expect(attempt?.status).toBe('cancelled')
  })

  it('starts several projects concurrently without exhausting the test pool', async () => {
    const created = await Promise.all(
      Array.from({ length: 6 }, () => createScriptProject()),
    )
    const queue = new InProcessQueue()

    const results = await withTimeout(Promise.all(
      created.map((item) => startWorkflow(item.project.id, queue)),
    ))

    expect(results).toHaveLength(6)
    expect(results.every((result) => result.status === 'started')).toBe(true)
    const attempts = await database.db
      .select({ id: taskAttempts.id })
      .from(taskAttempts)
    expect(attempts).toHaveLength(6)
  })
})

async function createAudioProject(workspaceId = WORKSPACE_ID) {
  return createProjectWithSource(
    {
      title: '录音工作流',
      source: {
        schemaVersion: 1,
        kind: 'audio',
        storageKey: 'project-sources/workflow-start/source.wav',
        fileName: '录音.wav',
        mimeType: 'audio/wav',
        container: 'wav',
        sizeBytes: 96_044,
        durationMs: 1_000,
        sampleRate: 48_000,
        sampleCount: 48_000,
        visualTheme: 'dark',
      },
      sourceFingerprint: 'a'.repeat(64),
    },
    {
      database: database.db,
      workspaceId,
      createId: randomUUID,
    },
  )
}

async function createScriptProject() {
  return createProjectWithSource(
    {
      title: '真实文稿工作流',
      source: {
        schemaVersion: 1,
        kind: 'script',
        script: '用于验证创建、Director 与队列持久化的一段真实文稿。',
        visualTheme: 'dark',
      },
      sourceFingerprint: 'b'.repeat(64),
    },
    {
      database: database.db,
      workspaceId: WORKSPACE_ID,
      createId: randomUUID,
    },
  )
}

function startWorkflow(projectId: string, queue: InProcessQueue) {
  return runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    () => startProjectWorkflow(projectId, workflowDependencies(queue)),
  )
}

function workflowDependencies(
  queue: InProcessQueue,
): ProjectWorkflowStartDependencies {
  const advanceRepository = new AdvanceRepositoryImpl(database.db)
  const runtimeRepository = new DirectorRuntimeRepository(database.db, storage)
  return {
    loadDescriptor: loadProjectWorkflowStartDescriptor,
    startScript: (projectId) => startProjectPipeline(projectId, {
      repository: advanceRepository,
      enqueueDirectorStage: (input, options) =>
        enqueueDirectorStageWithReceipt(input, {
          queue,
          assertEnqueueable: (payload, enqueueOptions) =>
            runtimeRepository.assertEnqueueable(
              payload.projectId,
              payload.nodeId,
              payload.stage,
              enqueueOptions?.allowPending,
            ),
          transitionNodeStatus,
          recordStageError: (nodeId, stage, error) =>
            runtimeRepository.recordStageError(nodeId, stage, error),
        }, options),
      advance: vi.fn(async () => ({
        enqueuedNodeIds: [],
        failedNodeIds: [],
      })),
      withResumeControl: (id, execution, operation) =>
        withProjectResumeControl(id, execution, operation, database.db),
    }),
    resumeAudio: async () => {
      throw new Error('unexpected audio resume')
    },
    enqueueAudio: async () => {
      throw new Error('unexpected audio enqueue')
    },
    enqueueWebsite: async () => {
      throw new Error('unexpected website enqueue')
    },
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('script start timed out')), 3_000)
    }),
  ])
}

function loadDescriptor(projectId: string) {
  return runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    () => loadProjectWorkflowStartDescriptor(projectId),
  )
}

async function seedPreSourceScript(workflowVersion: string) {
  const projectId = randomUUID()
  const entryNodeId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '既有文稿项目',
    script: '迁移前保存的真实文稿',
    workflowKind: 'script',
    workflowVersion,
    exportSettings: { schemaVersion: 1 },
  })
  await database.db.insert(canvasNodes).values({
    workspaceId: WORKSPACE_ID,
    id: entryNodeId,
    projectId,
    type: 'script-import',
    stage: 'INGEST',
    logicalKey: 'global:script-import',
    data: { schemaVersion: 1, payload: {} },
  })
  return { projectId, entryNodeId }
}
