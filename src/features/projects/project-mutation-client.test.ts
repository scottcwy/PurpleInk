import { describe, expect, it, vi } from 'vitest'
import {
  deleteProjectRequest,
  renameProjectRequest,
  validateProjectTitle,
} from './project-mutation-client'

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('validateProjectTitle', () => {
  it('rejects an empty or whitespace-only title', () => {
    expect(validateProjectTitle('')).toBe('标题不能为空')
    expect(validateProjectTitle('   ')).toBe('标题不能为空')
  })

  it('rejects a title longer than 200 characters', () => {
    expect(validateProjectTitle('x'.repeat(201))).toBe('标题不能超过 200 字')
  })

  it('accepts a trimmed title at the boundary', () => {
    expect(validateProjectTitle('x'.repeat(200))).toBeNull()
    expect(validateProjectTitle('  项目  ')).toBeNull()
  })
})

describe('renameProjectRequest', () => {
  it('patches only the title and returns the persisted value', async () => {
    const fetcher = vi.fn(async () =>
      response(200, { ok: true, project: { id: 'p1', title: '新名字' } }),
    )

    await expect(renameProjectRequest('p 1', '新名字', fetcher)).resolves.toBe('新名字')
    expect(fetcher).toHaveBeenCalledWith('/api/projects/p%201', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '新名字' }),
    })
  })

  it('surfaces the server category message on failure', async () => {
    const fetcher = vi.fn(async () =>
      response(400, { ok: false, error: '标题不能超过 200 字' }),
    )

    await expect(renameProjectRequest('p1', 'x', fetcher)).rejects.toThrow(
      '标题不能超过 200 字',
    )
  })
})

describe('deleteProjectRequest', () => {
  it('issues a DELETE and resolves on success', async () => {
    const fetcher = vi.fn(async () => response(200, { ok: true, deletedArtifacts: 2 }))

    await expect(deleteProjectRequest('p1', fetcher)).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/projects/p1', { method: 'DELETE' })
  })

  it('surfaces the 409 blocked message instead of a generic failure', async () => {
    const fetcher = vi.fn(async () =>
      response(409, {
        ok: false,
        error: '项目仍有执行中的作业，请先停止项目并等待作业退出后再删除',
        code: 'PROJECT_DELETE_BLOCKED',
      }),
    )

    await expect(deleteProjectRequest('p1', fetcher)).rejects.toThrow(
      '项目仍有执行中的作业，请先停止项目并等待作业退出后再删除',
    )
  })
})
