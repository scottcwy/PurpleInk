import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  runInAuthContext,
  SYSTEM_USER_ID,
} from '@/lib/auth/workspace-context'
import { projects, workspaces } from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { enableProjectAutomaticAdvance } from './automatic-advance-control'

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
    slug: 'automatic-advance-control',
    name: 'Automatic advance control',
  })
})

afterAll(async () => {
  await database.close()
})

it('enables only the audio continuation latch for an audio recovery action', async () => {
  const projectId = await seedProject('audio')

  await inWorkspace(() =>
    enableProjectAutomaticAdvance(projectId, database.db))

  const [project] = await database.db.select().from(projects)
  expect(project).toMatchObject({
    workflowKind: 'audio',
    autopilot: false,
    directorContinuationEnabled: true,
  })
})

it('keeps script recovery on the script-only autopilot latch', async () => {
  const projectId = await seedProject('script')

  await inWorkspace(() =>
    enableProjectAutomaticAdvance(projectId, database.db))

  const [project] = await database.db.select().from(projects)
  expect(project).toMatchObject({
    workflowKind: 'script',
    autopilot: true,
    directorContinuationEnabled: false,
  })
})

it('rejects website projects instead of enabling a Director latch', async () => {
  const projectId = await seedProject('website')

  await expect(inWorkspace(() =>
    enableProjectAutomaticAdvance(projectId, database.db)))
    .rejects.toThrow('不支持 Director 自动推进')

  const [project] = await database.db.select().from(projects)
  expect(project).toMatchObject({
    autopilot: false,
    directorContinuationEnabled: false,
  })
})

async function seedProject(
  workflowKind: 'script' | 'audio' | 'website',
): Promise<string> {
  const projectId = randomUUID()
  await database.db.insert(projects).values({
    workspaceId: WORKSPACE_ID,
    id: projectId,
    title: '自动推进控制测试',
    script: '',
    workflowKind,
    workflowVersion: 'test',
    exportSettings: { schemaVersion: 1 },
    autopilot: false,
    directorContinuationEnabled: false,
  })
  return projectId
}

function inWorkspace<T>(operation: () => Promise<T>): Promise<T> {
  return runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: SYSTEM_USER_ID },
    operation,
  )
}
