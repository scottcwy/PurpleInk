import { describe, expect, it, vi } from 'vitest'
import { createProjectAndStartIngest } from './new-project-api'

describe('createProjectAndStartIngest', () => {
  it('creates a project, queues its trusted INGEST node, then returns the project id', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, project: { id: 'project-1' }, ingestNodeId: 'node-1' }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true, jobId: 'job-1' }, 200))

    await expect(
      createProjectAndStartIngest({ title: 'RAG 十分钟入门', script: '稿件' }, fetcher)
    ).resolves.toEqual({ projectId: 'project-1' })
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/director/stage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          stage: 'INGEST',
        }),
      })
    )
  })
})

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
