import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE, PATCH } from './route'

const mocks = vi.hoisted(() => {
  class ProjectTitleError extends Error {
    readonly code = 'INVALID_PROJECT_TITLE'
    readonly statusCode = 400
  }
  class ProjectNotFoundError extends Error {
    readonly code = 'PROJECT_NOT_FOUND'
    readonly statusCode = 404
  }
  class ProjectDeleteBlockedError extends Error {
    readonly code = 'PROJECT_DELETE_BLOCKED'
    readonly statusCode = 409
  }
  return {
    updateExportSettings: vi.fn(),
    renameProject: vi.fn(),
    deleteProject: vi.fn(),
    ProjectTitleError,
    ProjectNotFoundError,
    ProjectDeleteBlockedError,
  }
})

vi.mock('server-only', () => ({}))
// 会话层单独有 pg 测试覆盖；这里只验路由分支，直接以假会话放行。
vi.mock('@/features/auth/api-session', () => ({
  withApiSession: (handler: (session: unknown) => Promise<Response>) =>
    handler({ userId: 'user-1', workspaceId: 'ws-1' }),
}))
vi.mock('@/features/canvas', async () => {
  const { z } = await import('zod')
  return {
    updateExportSettings: mocks.updateExportSettings,
    exportSettingsSchema: z.object({ resolution: z.enum(['1080p', '720p']) }),
  }
})
vi.mock('@/features/projects', () => ({
  renameProject: mocks.renameProject,
  deleteProject: mocks.deleteProject,
  ProjectTitleError: mocks.ProjectTitleError,
  ProjectNotFoundError: mocks.ProjectNotFoundError,
  ProjectDeleteBlockedError: mocks.ProjectDeleteBlockedError,
}))

const params = Promise.resolve({ id: 'project-1' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/projects/[id]', () => {
  it('renames the project when the body carries a title', async () => {
    mocks.renameProject.mockResolvedValue({ id: 'project-1', title: '新标题' })

    const response = await PATCH(patchRequest({ title: '新标题' }), { params })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      project: { id: 'project-1', title: '新标题' },
    })
    expect(mocks.updateExportSettings).not.toHaveBeenCalled()
  })

  it('rejects an invalid title without writing', async () => {
    mocks.renameProject.mockRejectedValue(
      new mocks.ProjectTitleError('标题不能超过 200 字'),
    )

    const response = await PATCH(patchRequest({ title: 'x'.repeat(201) }), { params })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_PROJECT_TITLE',
    })
  })

  it('keeps the existing exportSettings branch intact', async () => {
    mocks.updateExportSettings.mockResolvedValue({ resolution: '720p' })

    const response = await PATCH(
      patchRequest({ exportSettings: { resolution: '720p' } }),
      { params },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      exportSettings: { resolution: '720p' },
    })
    expect(mocks.renameProject).not.toHaveBeenCalled()
  })

  it('returns 400 when neither branch is addressed', async () => {
    const response = await PATCH(patchRequest({ nothing: true }), { params })

    expect(response.status).toBe(400)
    expect(mocks.renameProject).not.toHaveBeenCalled()
    expect(mocks.updateExportSettings).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/projects/[id]', () => {
  it('deletes the project and reports what was removed', async () => {
    mocks.deleteProject.mockResolvedValue({
      projectId: 'project-1',
      deletedArtifacts: 3,
      removedStorageKeys: 3,
    })

    const response = await DELETE(deleteRequest(), { params })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      projectId: 'project-1',
      deletedArtifacts: 3,
      removedStorageKeys: 3,
    })
  })

  it('maps a missing project to 404', async () => {
    mocks.deleteProject.mockRejectedValue(new mocks.ProjectNotFoundError('项目不存在'))

    const response = await DELETE(deleteRequest(), { params })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'PROJECT_NOT_FOUND' })
  })

  it('maps an in-flight project to 409', async () => {
    mocks.deleteProject.mockRejectedValue(
      new mocks.ProjectDeleteBlockedError('项目仍有执行中的作业'),
    )

    const response = await DELETE(deleteRequest(), { params })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PROJECT_DELETE_BLOCKED',
    })
  })

  it('does not expose database internals on unexpected failure', async () => {
    mocks.deleteProject.mockRejectedValue(
      new Error('postgres foreign key artifacts_attempt_fk'),
    )

    const response = await DELETE(deleteRequest(), { params })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: '项目删除失败',
    })
  })
})

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(): Request {
  return new Request('http://localhost/api/projects/project-1', { method: 'DELETE' })
}
