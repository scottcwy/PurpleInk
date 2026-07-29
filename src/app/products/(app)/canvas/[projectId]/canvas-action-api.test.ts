import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraphNode } from '@/features/canvas'
import {
  BillingQuotaExhaustedError,
  startPipeline,
  stopPipeline,
  triggerCancelProviderWait,
  triggerNodeAction,
  triggerNodeSkip,
} from './canvas-action-api'

describe('triggerNodeAction', () => {
  it('uses the persisted stage for Director nodes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(actionResult('job-1', 'execute'))
    )
    await expect(
      triggerNodeAction(
        'project-1',
        node({ type: 'script-import', stage: 'INGEST' }),
        fetcher
      )
    ).resolves.toMatchObject({ jobId: 'job-1', action: 'execute' })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/stage',
      expect.objectContaining({
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'execute',
        }),
      })
    )
  })

  it('routes shot-codegen through the render API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(actionResult('render-1', 'rerender'))
    )
    await expect(
      triggerNodeAction(
        'project-1',
        node({ type: 'shot-codegen', stage: 'FABRICATE', status: 'success' }),
        fetcher
      )
    ).resolves.toMatchObject({ jobId: 'render-1', action: 'rerender' })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/render',
      expect.objectContaining({
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'rerender',
        }),
      })
    )
  })

  it('requests bounded repair for failed nodes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(actionResult('repair-1', 'repair-upstream', 'script-s002'))
    )
    await triggerNodeAction(
      'project-1',
      node({ type: 'shot-codegen', stage: 'FABRICATE', status: 'failed' }),
      fetcher
    )
    expect(fetcher).toHaveBeenCalledWith(
      '/api/render',
      expect.objectContaining({
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'repair',
        }),
      })
    )
  })

  it('requests regeneration for a successful Director node', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(actionResult('regenerate-1', 'regenerate'))
    )
    await triggerNodeAction(
      'project-1',
      node({ type: 'shot-script', stage: 'SHOT_SPEC', status: 'success' }),
      fetcher
    )
    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/stage',
      expect.objectContaining({
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'regenerate',
        }),
      })
    )
  })
})

describe('triggerNodeSkip', () => {
  it('posts intent=skip with the reason to the stage endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(actionResult('attempt-1', 'skip'))
    )
    await expect(
      triggerNodeSkip(
        'project-1',
        node({ type: 'shot-sfx', stage: 'ASSEMBLE', status: 'failed' }),
        '素材缺失，先用占位继续',
        fetcher
      )
    ).resolves.toMatchObject({ jobId: 'attempt-1', action: 'skip' })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/stage',
      expect.objectContaining({
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'skip',
          skipReason: '素材缺失，先用占位继续',
        }),
      })
    )
  })

  it('surfaces the server rejection message on 422', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: '该环节不支持跳过。', code: 'SKIP_REJECTED' }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      )
    )
    await expect(
      triggerNodeSkip(
        'project-1',
        node({ type: 'shot-qa', stage: 'FINALIZE', status: 'failed' }),
        '想跳过质检',
        fetcher
      )
    ).rejects.toThrow('该环节不支持跳过。')
  })

  it('rejects responses with an unknown action shape', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ ...actionResult('x', 'skip'), action: 'nope' })
    )
    await expect(
      triggerNodeSkip(
        'project-1',
        node({ type: 'shot-sfx', stage: 'ASSEMBLE', status: 'failed' }),
        '原因',
        fetcher
      )
    ).rejects.toThrow('作业响应缺少恢复结果')
  })
})

describe('triggerCancelProviderWait', () => {
  it('posts intent=cancel-wait to the stage endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(actionResult('attempt-2', 'cancel-wait'))
    )

    await expect(
      triggerCancelProviderWait(
        'project-1',
        node({ type: 'shot-script', stage: 'SHOT_SPEC', status: 'pending' }),
        fetcher
      )
    ).resolves.toMatchObject({ jobId: 'attempt-2', action: 'cancel-wait' })

    expect(fetcher).toHaveBeenCalledWith(
      '/api/director/stage',
      expect.objectContaining({
        body: JSON.stringify({
          projectId: 'project-1',
          nodeId: 'node-1',
          intent: 'cancel-wait',
        }),
      })
    )
  })
})

describe('pipeline controls', () => {
  it('preserves the public quota contract for the upgrade dialog', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        code: 'quota_exhausted',
        resetAt: '2026-08-27T00:00:00.000Z',
        billingUrl: '/products/billing',
      }), { status: 402, headers: { 'content-type': 'application/json' } }),
    )

    await expect(startPipeline('project-1', fetcher)).rejects.toEqual(
      new BillingQuotaExhaustedError(
        '2026-08-27T00:00:00.000Z',
        '/products/billing',
      ),
    )
  })

  it('starts project autopilot through the pipeline endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ok: true,
        autopilot: true,
        status: 'started',
        enqueuedNodeIds: ['node-1'],
        repairRootNodeIds: ['node-1'],
        failedNodeIds: ['node-2'],
        blockedNodes: [],
      })
    )

    await expect(startPipeline('project-1', fetcher)).resolves.toEqual({
      autopilot: true,
      status: 'started',
      enqueuedNodeIds: ['node-1'],
      repairRootNodeIds: ['node-1'],
      failedNodeIds: ['node-2'],
      blockedNodes: [],
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

function actionResult(
  jobId: string,
  action:
    | 'execute'
    | 'repair-upstream'
    | 'regenerate'
    | 'rerender'
    | 'skip'
    | 'cancel-wait',
  queuedNodeId = 'node-1'
) {
  return {
    ok: true,
    action,
    requestedNodeId: 'node-1',
    queuedNodeId,
    jobId,
    message: '已排队',
  }
}
