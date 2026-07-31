import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import { canvasNodes, projects, workspaces } from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { activeWorkflowVersionFor } from '@/lib/workflow/project-workflow-registry'
import { createProjectWithSource } from './project-creation'
import {
  loadProjectWorkflowStartDescriptor,
  ProjectWorkflowStartError,
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
