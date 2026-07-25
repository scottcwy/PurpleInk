import { describe, expect, it, vi } from 'vitest'
import type { QueueAdapter } from '@/lib/queue'
import type { RenderJob, RenderResult } from './types'
import {
  enqueueRenderShot,
  registerRenderShotHandler,
} from './queue-handler'

vi.mock('server-only', () => ({}))

const renderJob: RenderJob = {
  projectId: 'project-1',
  nodeId: 'node-1',
  shotId: 'S001',
  htmlKey: 'director/S001.html',
  frames: { fps: 30, durationInFrames: 60, width: 1920, height: 1080 },
}

function createQueue() {
  let handler: ((job: {
    id: string
    kind: string
    status: 'running'
    payload: Record<string, unknown>
    attempts: number
  }) => Promise<void>) | undefined
  const queue: QueueAdapter = {
    enqueue: vi.fn(async () => 'job-1'),
    register: vi.fn((_kind, nextHandler) => {
      handler = nextHandler
    }),
    start: vi.fn(),
    stop: vi.fn(),
  }
  return { queue, getHandler: () => handler }
}

describe('render queue handler', () => {
  it('loads context and completes running to success', async () => {
    const harness = createQueue()
    const statuses: string[] = []
    const renderer = {
      render: vi.fn(async (): Promise<RenderResult> => ({
        shotId: 'S001',
        outputKey: 'render/S001.mp4',
        contentHash: 'hash',
      })),
    }
    registerRenderShotHandler(harness.queue, {
      repository: {
        loadRenderContext: vi.fn(async () => renderJob),
        recordRenderError: vi.fn(async () => {}),
      },
      transitionNodeStatus: vi.fn(async (_nodeId, status) => {
        statuses.push(status)
      }),
      renderer,
      advancePipeline: vi.fn(async () => statuses.push('advance')),
    })

    await harness.getHandler()?.({
      id: 'job-1',
      kind: 'render-shot',
      status: 'running',
      payload: { projectId: 'project-1', nodeId: 'node-1' },
      attempts: 1,
    })

    expect(renderer.render).toHaveBeenCalledWith(renderJob)
    expect(statuses).toEqual(['running', 'success', 'advance'])
  })

  it('moves render failures to failed and records the error', async () => {
    const harness = createQueue()
    const failure = new Error('编码失败')
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})
    registerRenderShotHandler(harness.queue, {
      repository: {
        loadRenderContext: vi.fn(async () => renderJob),
        recordRenderError,
      },
      transitionNodeStatus,
      renderer: { render: vi.fn(async () => { throw failure }) },
      advancePipeline: vi.fn(),
    })

    await expect(
      harness.getHandler()?.({
        id: 'job-1',
        kind: 'render-shot',
        status: 'running',
        payload: { projectId: 'project-1', nodeId: 'node-1' },
        attempts: 1,
      })
    ).rejects.toThrow(failure)
    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'running',
      'failed',
    ])
    expect(recordRenderError).toHaveBeenCalledWith('node-1', failure)
  })

  it('fails directly when the committed source is missing', async () => {
    const harness = createQueue()
    const missingSource = new Error('节点缺少 director-fabricate 产物：node-1')
    const loadRenderContext = vi.fn(async () => {
      throw missingSource
    })
    const renderer = { render: vi.fn() }
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})
    const advancePipeline = vi.fn()
    registerRenderShotHandler(harness.queue, {
      repository: {
        loadRenderContext,
        recordRenderError,
      },
      transitionNodeStatus,
      renderer,
      advancePipeline,
    })

    await expect(
      harness.getHandler()?.({
        id: 'job-1',
        kind: 'render-shot',
        status: 'running',
        payload: { projectId: 'project-1', nodeId: 'node-1' },
        attempts: 1,
      })
    ).rejects.toBe(missingSource)
    expect(loadRenderContext).toHaveBeenCalledOnce()
    expect(renderer.render).not.toHaveBeenCalled()
    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'running',
      'failed',
    ])
    expect(recordRenderError).toHaveBeenCalledWith('node-1', missingSource)
    expect(advancePipeline).not.toHaveBeenCalled()
  })

  it('loads admission, validates, marks pending, and enqueues a render job', async () => {
    const harness = createQueue()
    const order: string[] = []
    vi.mocked(harness.queue.enqueue).mockImplementation(async () => {
      order.push('enqueue')
      return 'job-1'
    })
    const jobId = await enqueueRenderShot(
      { projectId: 'project-1', nodeId: 'node-1' },
      {
        queue: harness.queue,
        loadAdmissionContext: vi.fn(async () => {
          order.push('load')
          return renderJob
        }),
        assertAdmission: vi.fn(async () => {
          order.push('admission')
        }),
        transitionNodeStatus: vi.fn(async (_nodeId, status) => {
          order.push(status)
        }),
        recordRenderError: vi.fn(async () => {}),
      }
    )

    expect(jobId).toBe('job-1')
    expect(order).toEqual(['load', 'admission', 'pending', 'enqueue'])
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      'render-shot',
      { projectId: 'project-1', nodeId: 'node-1' },
      { projectId: 'project-1', nodeId: 'node-1' }
    )
  })

  it('rejects runtime admission before pending or queue side effects', async () => {
    const harness = createQueue()
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})

    await expect(
      enqueueRenderShot(
        { projectId: 'project-1', nodeId: 'node-1' },
        {
          queue: harness.queue,
          loadAdmissionContext: vi.fn(async () => renderJob),
          assertAdmission: vi.fn(async () => {
            throw new Error('shot 缺少 window.__CVC_RENDER__ runtime')
          }),
          transitionNodeStatus,
          recordRenderError,
        }
      )
    ).rejects.toThrow('shot 缺少 window.__CVC_RENDER__ runtime')
    expect(transitionNodeStatus).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(recordRenderError).not.toHaveBeenCalled()
  })

  it('rejects a missing committed source before admission or status changes', async () => {
    const harness = createQueue()
    const assertAdmission = vi.fn()
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})

    await expect(
      enqueueRenderShot(
        { projectId: 'project-1', nodeId: 'node-1' },
        {
          queue: harness.queue,
          loadAdmissionContext: vi.fn(async () => {
            throw new Error('节点缺少 director-fabricate 产物：node-1')
          }),
          assertAdmission,
          transitionNodeStatus,
          recordRenderError,
        }
      )
    ).rejects.toThrow('节点缺少 director-fabricate 产物')
    expect(assertAdmission).not.toHaveBeenCalled()
    expect(transitionNodeStatus).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(recordRenderError).not.toHaveBeenCalled()
  })

  it('compensates a failed enqueue without leaving pending state', async () => {
    const harness = createQueue()
    vi.mocked(harness.queue.enqueue).mockImplementation(async () => {
      throw new Error('队列写入失败')
    })
    const statuses: string[] = []
    const recordRenderError = vi.fn(async () => {})

    await expect(
      enqueueRenderShot(
        { projectId: 'project-1', nodeId: 'node-1' },
        {
          queue: harness.queue,
          loadAdmissionContext: vi.fn(async () => renderJob),
          assertAdmission: vi.fn(async () => {}),
          transitionNodeStatus: vi.fn(async (_nodeId, status) => {
            statuses.push(status)
          }),
          recordRenderError,
        }
      )
    ).rejects.toThrow('队列写入失败')
    expect(statuses).toEqual(['pending', 'running', 'failed'])
    expect(recordRenderError).toHaveBeenCalledWith('node-1', expect.any(Error))
  })
})
