import { describe, expect, it, vi } from 'vitest'
import type { JobHandler, QueueAdapter } from '@/lib/queue'
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

    await harness.getHandler()?.({
      id: 'job-1',
      kind: 'director-stage',
      status: 'running',
      payload: payload ?? {},
      attempts: 1,
    })

    expect(harness.queue.register).toHaveBeenCalledWith(
      'director-stage',
      expect.any(Function)
    )
    expect(runStage).toHaveBeenCalledWith('project-1', 'node-1', 'INGEST')
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
        transitionNodeStatus,
        recordStageError: vi.fn(async () => {}),
      }
    )

    expect(jobId).toBe('job-1')
    expect(order).toEqual(['validate', 'pending', 'enqueue'])
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      'director-stage',
      { projectId: 'project-1', nodeId: 'node-1', stage: 'INGEST' },
      { projectId: 'project-1', nodeId: 'node-1' }
    )
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
