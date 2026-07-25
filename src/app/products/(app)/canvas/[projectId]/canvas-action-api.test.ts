import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraphNode } from '@/features/canvas'
import {
  startPipeline,
  stopPipeline,
  triggerNodeAction,
} from './canvas-action-api'

describe('triggerNodeAction', () => {
  it('uses the persisted stage for Director nodes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ ok: true, jobId: 'job-1' })
    )
    await expect(
      triggerNodeAction(
        'project-1',
        node({ type: 'script-import', stage: 'INGEST' }),
        fetcher
      )
    ).resolves.toBe('job-1')

    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/stage',
      expect.objectContaining({
        body: JSON.stringify({ projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' }),
      })
    )
  })

  it('routes shot-codegen through the render API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ ok: true, jobId: 'render-1' })
    )
    await expect(
      triggerNodeAction(
        'project-1',
        node({ type: 'shot-codegen', stage: 'FABRICATE' }),
        fetcher
      )
    ).resolves.toBe('render-1')

    expect(fetcher).toHaveBeenCalledWith(
      '/api/render',
      expect.objectContaining({
        body: JSON.stringify({ projectId: 'project-1', nodeId: 'node-1' }),
      })
    )
  })
})

describe('pipeline controls', () => {
  it('starts project autopilot through the pipeline endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ok: true,
        autopilot: true,
        enqueuedNodeIds: ['node-1'],
        failedNodeIds: ['node-2'],
      })
    )

    await expect(startPipeline('project-1', fetcher)).resolves.toEqual({
      autopilot: true,
      enqueuedNodeIds: ['node-1'],
      failedNodeIds: ['node-2'],
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/pipeline',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-1' }),
      })
    )
  })

  it('stops project autopilot without pretending queued jobs were cancelled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ ok: true, autopilot: false })
    )

    await expect(stopPipeline('project-1', fetcher)).resolves.toEqual({
      autopilot: false,
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/pipeline',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ projectId: 'project-1' }),
      })
    )
  })
})

function node(overrides: Partial<CanvasGraphNode>): CanvasGraphNode {
  return {
    id: 'node-1',
    type: 'script-import',
    status: 'idle',
    stage: null,
    contentHash: null,
    data: {},
    position: { x: 0, y: 0 },
    laneKey: null,
    laneRole: null,
    artifacts: [],
    ...overrides,
  }
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
