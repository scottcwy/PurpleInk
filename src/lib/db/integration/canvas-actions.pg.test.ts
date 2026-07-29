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
  UnsupportedProjectWorkflowError,
} from '@/features/projects/project-compatibility'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from '@/lib/workflow/version'
import {
  getExportSettings,
  getProjectAutopilot,
} from '@/features/canvas/queries'

// 被测模块经 currentWorkspaceId() 取归属（PLAN-002 阶段 B）；单测没有请求入口，
// 把读取口 mock 成历史单工作区 id，与用例 seed 的数据保持一致。
vi.mock('@/lib/auth/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/workspace-context')>()),
  currentWorkspaceId: () => '00000000-0000-4000-8000-000000000001',
  currentUserId: () => 'test-user',
}))

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
  // 阶段 B 后 createProject 不再自建 workspace（创建点唯一在注册事务），
  // 用例自行 seed 归属行。
  await database.db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, slug: 'local', name: 'Local Workspace' })
    .onConflictDoNothing()
})

afterAll(async () => {
  await database.close()
})

describe('createProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockResolvedValue(database.db)
  })

  it('atomically creates the project and four global nodes in the session workspace', async () => {
    const result = createProject({ title: 'RAG 十分钟入门', script: '测试稿件' })
    expect(result).toBeInstanceOf(Promise)
    const project = await result
    const nodes = await database.db.select().from(canvasNodes)
    const edges = await database.db.select().from(canvasEdges)

    expect(project.title).toBe('RAG 十分钟入门')
    expect(project.kind).toBe('script')
    const [persistedProject] = await database.db.select().from(projects)
    expect(persistedProject?.workflowKind).toBe('script')
    expect(persistedProject?.workflowVersion).toBe(
      serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION)
    )
    expect(persistedProject?.exportSettings).toEqual({
      schemaVersion: 1,
      settings: { resolutionPreset: '1920x1080' },
    })
    expect(nodes.every((node) => node.workspaceId === WORKSPACE_ID)).toBe(true)
    expect(nodes.map(({ type, stage }) => [type, stage])).toEqual([
      ['script-import', 'INGEST'],
      ['shot-split', 'DIRECT'],
      ['score', 'ASSEMBLE'],
      ['export', 'FINALIZE'],
    ])
    expect(nodes[0]?.data).toEqual({
      schemaVersion: 1,
      payload: {
        directorInput: { rawScript: '测试稿件' },
        visualTheme: 'dark',
      },
    })
    expect(edges.map(({ source, target }) => [source, target])).toEqual([
      [nodes[0]?.id, nodes[1]?.id],
      [nodes[2]?.id, nodes[3]?.id],
    ])
  })

  it('rolls back the project when initial graph creation fails', async () => {
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
    // seed 的 workspace 行不受事务影响：createProject 不再负责建/删 workspace。
    expect(await database.db.select().from(workspaces)).toHaveLength(1)
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
      resolutionPreset: '1920x1080',
    })
  })

  it('persists a valid versioned preset and reads it back', async () => {
    await updateExportSettings(projectId, { resolutionPreset: '1280x720' })
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1280x720',
    })
    const [row] = await database.db
      .select({ exportSettings: projects.exportSettings })
      .from(projects)
    expect(row?.exportSettings).toEqual({
      schemaVersion: 1,
      settings: { resolutionPreset: '1280x720' },
    })
  })

  it('rejects an invalid preset without writing', async () => {
    await expect(
      updateExportSettings(projectId, { resolutionPreset: '9999x9999' })
    ).rejects.toThrow()
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1920x1080',
    })
  })

  it('throws when the project does not exist', async () => {
    await expect(
      updateExportSettings(randomUUID(), { resolutionPreset: '1280x720' })
    ).rejects.toThrow('项目不存在')
  })

  it('rejects a legacy workflow before changing export settings', async () => {
    await database.db
      .update(projects)
      .set({ workflowVersion: 'legacy-portrait-workflow' })
    await expect(
      updateExportSettings(projectId, { resolutionPreset: '1280x720' })
    ).rejects.toBeInstanceOf(UnsupportedProjectWorkflowError)
    const [row] = await database.db.select().from(projects)
    expect(row?.exportSettings).toEqual({
      schemaVersion: 1,
      settings: { resolutionPreset: '1920x1080' },
    })
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

  it('rejects a legacy workflow before changing autopilot', async () => {
    await database.db
      .update(projects)
      .set({ workflowVersion: 'legacy-portrait-workflow' })
    await expect(setProjectAutopilot(projectId, true)).rejects.toBeInstanceOf(
      UnsupportedProjectWorkflowError
    )
    await expect(getProjectAutopilot(projectId)).resolves.toBe(false)
  })
})
