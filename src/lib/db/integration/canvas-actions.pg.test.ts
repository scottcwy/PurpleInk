import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  canvasEdges,
  canvasNodes,
  projects,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  createProject,
  setProjectAutopilot,
  updateExportSettings,
} from '@/features/canvas/actions'
import {
  getExportSettings,
  getProjectAutopilot,
} from '@/features/canvas/queries'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn<() => Promise<Db>>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', () => ({
  getDb: getDbMock,
  LOCAL_WORKSPACE_ID: '00000000-0000-4000-8000-000000000001',
}))

let database: PgTestDatabase

beforeAll(async () => {
  database = await createPgTestDatabase()
})

beforeEach(async () => {
  await database.reset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => {
  await database.close()
})

describe('createProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockResolvedValue(database.db)
  })

  it('atomically creates the local workspace, project, and four global nodes', async () => {
    const result = createProject({ title: 'RAG 十分钟入门', script: '测试稿件' })
    expect(result).toBeInstanceOf(Promise)
    const project = await result
    const nodes = await database.db.select().from(canvasNodes)
    const edges = await database.db.select().from(canvasEdges)

    expect(project.title).toBe('RAG 十分钟入门')
    expect(nodes.every((node) => node.workspaceId === WORKSPACE_ID)).toBe(true)
    expect(nodes.map(({ type, stage }) => [type, stage])).toEqual([
      ['script-import', 'INGEST'],
      ['shot-split', 'DIRECT'],
      ['score', 'ASSEMBLE'],
      ['export', 'FINALIZE'],
    ])
    expect(nodes[0]?.data).toEqual({
      schemaVersion: 1,
      payload: { directorInput: { rawScript: '测试稿件' } },
    })
    expect(edges.map(({ source, target }) => [source, target])).toEqual([
      [nodes[0]?.id, nodes[1]?.id],
      [nodes[2]?.id, nodes[3]?.id],
    ])
  })

  it('rolls back workspace and project when initial graph creation fails', async () => {
    await database.sql`
      CREATE FUNCTION fail_initial_graph() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected graph failure';
      END;
      $$ LANGUAGE plpgsql
    `
    await database.sql`
      CREATE TRIGGER fail_initial_graph
      BEFORE INSERT ON canvas_nodes
      FOR EACH ROW EXECUTE FUNCTION fail_initial_graph()
    `

    await expect(
      createProject({ title: '失败项目', script: '稿件' })
    ).rejects.toThrow()
    expect(await database.db.select().from(projects)).toHaveLength(0)
    expect(await database.db.select().from(workspaces)).toHaveLength(0)
  })
})

describe('export settings', () => {
  let projectId: string

  beforeEach(async () => {
    projectId = (
      await createProject({ title: '设置项目', script: '' })
    ).id
  })

  it('defaults to the master preset when never set', async () => {
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1080x1920',
    })
  })

  it('persists a valid versioned preset and reads it back', async () => {
    await updateExportSettings(projectId, { resolutionPreset: '720x1280' })
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '720x1280',
    })
    const [row] = await database.db
      .select({ exportSettings: projects.exportSettings })
      .from(projects)
    expect(row?.exportSettings).toEqual({
      schemaVersion: 1,
      settings: { resolutionPreset: '720x1280' },
    })
  })

  it('rejects an invalid preset without writing', async () => {
    await expect(
      updateExportSettings(projectId, { resolutionPreset: '9999x9999' })
    ).rejects.toThrow()
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1080x1920',
    })
  })

  it('throws when the project does not exist', async () => {
    await expect(
      updateExportSettings(randomUUID(), { resolutionPreset: '720x1280' })
    ).rejects.toThrow('项目不存在')
  })
})

describe('project autopilot', () => {
  let projectId: string

  beforeEach(async () => {
    projectId = (
      await createProject({ title: '自动推进项目', script: '' })
    ).id
  })

  it('defaults to disabled and persists explicit changes', async () => {
    await expect(getProjectAutopilot(projectId)).resolves.toBe(false)

    await expect(setProjectAutopilot(projectId, true)).resolves.toBe(true)
    await expect(getProjectAutopilot(projectId)).resolves.toBe(true)

    await expect(setProjectAutopilot(projectId, false)).resolves.toBe(false)
    await expect(getProjectAutopilot(projectId)).resolves.toBe(false)
  })

  it('rejects an unknown project without creating state', async () => {
    const missingId = randomUUID()
    await expect(setProjectAutopilot(missingId, true)).rejects.toThrow(
      '项目不存在'
    )
    await expect(getProjectAutopilot(missingId)).rejects.toThrow('项目不存在')
  })
})
