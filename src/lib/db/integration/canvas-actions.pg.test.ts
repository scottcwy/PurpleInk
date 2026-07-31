import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@/lib/db/client'
import {
  projects,
  workspaces,
} from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import {
  setProjectAutopilot,
  updateExportSettings,
} from '@/features/canvas/actions'
import { createProjectWithSource } from '@/features/projects'
import {
  UnsupportedProjectWorkflowError,
} from '@/features/projects/project-compatibility'
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
  // 项目服务不自建 workspace（创建点唯一在注册事务），用例自行 seed 归属行。
  await database.db
    .insert(workspaces)
    .values({ id: WORKSPACE_ID, slug: 'local', name: 'Local Workspace' })
    .onConflictDoNothing()
})

afterAll(async () => {
  await database.close()
})

describe('export settings', () => {
  let projectId: string

  beforeEach(async () => {
    projectId = (await createScriptProject('设置项目')).id
  })

  it('defaults to the master preset and burned-in subtitles when never set', async () => {
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1920x1080',
      subtitles: 'burn-in',
      soundEffects: 'off',
    })
  })

  it('persists a valid versioned preset and reads it back', async () => {
    await updateExportSettings(projectId, { resolutionPreset: '1280x720' })
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1280x720',
      subtitles: 'burn-in',
      soundEffects: 'off',
    })
    const [row] = await database.db
      .select({ exportSettings: projects.exportSettings })
      .from(projects)
    expect(row?.exportSettings).toEqual({
      schemaVersion: 1,
      settings: {
        resolutionPreset: '1280x720',
        subtitles: 'burn-in',
        soundEffects: 'off',
      },
    })
  })

  it('applies a single-field patch without resetting the other fields', async () => {
    // 这一列是整体覆盖写入的 jsonb：如果「只改分辨率」按完整对象写回，
    // 用户已选的字幕交付会被顺手抹回默认，反之亦然。
    await updateExportSettings(projectId, { subtitles: 'off' })
    await updateExportSettings(projectId, { soundEffects: 'procedural' })
    await updateExportSettings(projectId, { resolutionPreset: '960x540' })
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '960x540',
      subtitles: 'off',
      soundEffects: 'procedural',
    })
    await updateExportSettings(projectId, { subtitles: 'burn-in' })
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '960x540',
      subtitles: 'burn-in',
      soundEffects: 'procedural',
    })
  })

  it('rejects an invalid preset, an unknown mode and an empty patch without writing', async () => {
    await expect(
      updateExportSettings(projectId, { resolutionPreset: '9999x9999' })
    ).rejects.toThrow()
    await expect(
      updateExportSettings(projectId, { subtitles: 'srt' })
    ).rejects.toThrow()
    await expect(updateExportSettings(projectId, {})).rejects.toThrow()
    await expect(getExportSettings(projectId)).resolves.toEqual({
      resolutionPreset: '1920x1080',
      subtitles: 'burn-in',
      soundEffects: 'off',
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
      settings: {
        resolutionPreset: '1920x1080',
        subtitles: 'burn-in',
        soundEffects: 'off',
      },
    })
  })
})

describe('project autopilot', () => {
  let projectId: string

  beforeEach(async () => {
    projectId = (await createScriptProject('自动推进项目')).id
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

async function createScriptProject(title: string) {
  const result = await createProjectWithSource(
    {
      title,
      source: {
        schemaVersion: 1,
        kind: 'script',
        script: '用于设置测试的文稿',
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
  return result.project
}
