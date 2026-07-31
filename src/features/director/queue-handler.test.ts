import { describe, expect, it, vi } from 'vitest'
import {
  AutomaticAdvanceDisabledError,
  type JobHandler,
  type QueueAdapter,
} from '@/lib/queue'
import {
  enqueueDirectorStage,
  registerDirectorStageHandler,
  startDirectorQueue,
} from './queue-handler'

vi.mock('server-only', () => ({}))

function createQueue() {
  let handler: JobHandler | undefined
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

describe('director queue handler', () => {
  it('registers and dispatches a validated director-stage job', async () => {
    const harness = createQueue()
    const runStage = vi.fn(async () => {})
    registerDirectorStageHandler(harness.queue, runStage)
    await enqueueDirectorStage(
      { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' },
      {
        queue: harness.queue,
        assertEnqueueable: vi.fn(async () => {}),
        transitionNodeStatus: vi.fn(async () => {}),
        recordStageError: vi.fn(async () => {}),
      }
    )
    const payload = vi.mocked(harness.queue.enqueue).mock.calls[0]?.[1]
    const controller = new AbortController()

    await harness.getHandler()?.({
      id: 'job-1',
      workspaceId: 'ws-1',
      kind: 'director-stage',
      status: 'running',
      payload: payload ?? {},
      attempts: 1,
      signal: controller.signal,
    })

    expect(harness.queue.register).toHaveBeenCalledWith(
      'director-stage',
      expect.any(Function)
    )
    expect(runStage).toHaveBeenCalledWith(
      'project-1',
      'node-1',
      'INGEST',
      'job-1',
      controller.signal,
    )
  })

  it('moves the node to pending before enqueueing', async () => {
    const harness = createQueue()
    const order: string[] = []
    const transitionNodeStatus = vi.fn(async (_nodeId: string, status: string) => {
      order.push(status)
    })
    vi.mocked(harness.queue.enqueue).mockImplementation(async () => {
      order.push('enqueue')
      return 'job-1'
    })

    const jobId = await enqueueDirectorStage(
      { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' },
      {
        queue: harness.queue,
        assertEnqueueable: vi.fn(async () => {
          order.push('validate')
        }),
        captureInputFingerprint: vi.fn(async () => {
          order.push('fingerprint')
        }),
        transitionNodeStatus,
        recordStageError: vi.fn(async () => {}),
      }
    )

    expect(jobId).toBe('job-1')
    expect(order).toEqual(['validate', 'fingerprint', 'pending', 'enqueue'])
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      'director-stage',
      { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' },
      {
        projectId: 'project-1',
        nodeId: 'node-1',
        requireAutomaticAdvance: true,
      }
    )
  })

  it('projects a stop race as cancellation without recording a workflow failure', async () => {
    const harness = createQueue()
    const stopped = new AutomaticAdvanceDisabledError()
    vi.mocked(harness.queue.enqueue).mockRejectedValue(stopped)
    const transitionNodeStatus = vi.fn(
      async (_nodeId: string, _status: string) => {},
    )
    const recordStageError = vi.fn(async () => {})

    await expect(enqueueDirectorStage(
      { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' },
      {
        queue: harness.queue,
        assertEnqueueable: vi.fn(async () => {}),
        transitionNodeStatus,
        recordStageError,
      },
    )).rejects.toBe(stopped)

    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'pending',
      'cancelled',
    ])
    expect(recordStageError).not.toHaveBeenCalled()
  })

  it('compensates a failed enqueue instead of leaving pending state', async () => {
    const harness = createQueue()
    const failure = new Error('队列数据库不可用')
    vi.mocked(harness.queue.enqueue).mockRejectedValue(failure)
    const transitionNodeStatus = vi.fn(
      async (nodeId: string, status: string) => {
        void nodeId
        void status
      }
    )
    const recordStageError = vi.fn(async () => {})

    await expect(
      enqueueDirectorStage(
        { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' },
        {
          queue: harness.queue,
          assertEnqueueable: vi.fn(async () => {}),
          transitionNodeStatus,
          recordStageError,
        }
      )
    ).rejects.toBe(failure)

    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'pending',
      'running',
      'failed',
    ])
    expect(recordStageError).toHaveBeenCalledWith('node-1', 'INGEST', failure)
  })

  it('stops before queueing when the managed billing preflight rejects', async () => {
    const harness = createQueue()
    const quotaError = Object.assign(new Error('quota_exhausted'), {
      name: 'QuotaExhaustedError',
      code: 'quota_exhausted',
    })
    const transitionNodeStatus = vi.fn(
      async (_nodeId: string, _status: string) => {},
    )
    const recordStageError = vi.fn(async () => {})

    await expect(enqueueDirectorStage(
      { projectId: 'project-1', nodeId: 'node-1', stage: 'DIRECT' },
      {
        queue: harness.queue,
        assertEnqueueable: vi.fn(async () => {}),
        assertBillingAvailable: vi.fn(async () => {
          throw quotaError
        }),
        transitionNodeStatus,
        recordStageError,
      },
    )).rejects.toBe(quotaError)

    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'pending',
      'running',
      'failed',
    ])
    expect(recordStageError).toHaveBeenCalledWith('node-1', 'DIRECT', quotaError)
  })

  it('registers before starting the application queue', () => {
    const harness = createQueue()
    startDirectorQueue(harness.queue, vi.fn(async () => {}))

    expect(harness.queue.register).toHaveBeenCalledOnce()
    expect(harness.queue.start).toHaveBeenCalledOnce()
    expect(
      vi.mocked(harness.queue.register).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(harness.queue.start).mock.invocationCallOrder[0]!)
  })

  it('rejects a mismatched stage before changing state or writing a job', async () => {
    const harness = createQueue()
    const transitionNodeStatus = vi.fn(async () => {})
    const mismatch = new Error('Director 节点阶段不匹配')

    await expect(
      enqueueDirectorStage(
        { projectId: 'project-1', nodeId: 'node-1', stage: 'DIRECT' },
        {
          queue: harness.queue,
          assertEnqueueable: vi.fn(async () => {
            throw mismatch
          }),
          transitionNodeStatus,
          recordStageError: vi.fn(async () => {}),
        }
      )
    ).rejects.toBe(mismatch)

    expect(transitionNodeStatus).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
  })
})
