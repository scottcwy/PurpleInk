import { describe, expect, it, vi } from 'vitest'
import { createProjectAndStartIngest } from './new-project-api'

describe('createProjectAndStartIngest', () => {
  it('creates a project, queues its trusted INGEST node, then returns the project id', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ ok: true, project: { id: 'project-1' }, ingestNodeId: 'node-1' }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            action: 'execute',
            requestedNodeId: 'node-1',
            queuedNodeId: 'node-1',
            jobId: 'job-1',
            message: '已排队执行此阶段',
          },
          200
        )
      )

    await expect(
      createProjectAndStartIngest(
        { title: 'RAG 十分钟入门', script: '稿件', visualTheme: 'light' },
        fetcher
      )
    ).resolves.toEqual({ projectId: 'project-1' })
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/api/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'RAG 十分钟入门',
          script: '稿件',
          visualTheme: 'light',
        }),
      })
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/director/stage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'execute',
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
