import { describe, expect, it, vi } from 'vitest'
import type { QueueAdapter } from '@/lib/queue'
import type { RenderAdmissionContext, RenderJob, RenderResult } from './types'
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

const enqueueContext: RenderAdmissionContext = {
  enqueue: { projectId: 'project-1', nodeId: 'node-1', shotId: 'S001' },
  job: null,
}

const retryAdmissionContext: RenderAdmissionContext = {
  enqueue: enqueueContext.enqueue,
  job: renderJob,
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
  it('generates HTML via fabricateShot when no director-fabricate artifact exists yet', async () => {
    const harness = createQueue()
    const statuses: string[] = []
    const fabricateShot = vi.fn(async () => {
      statuses.push('fabricate')
    })
    const renderer = {
      render: vi.fn(async (): Promise<RenderResult> => ({
        shotId: 'S001',
        outputKey: 'render/S001.mp4',
        contentHash: 'hash',
      })),
    }
    const recordOutputHash = vi.fn(async () => {})
    registerRenderShotHandler(harness.queue, {
      repository: {
        hasFabricateArtifact: vi.fn(async () => false),
        loadRenderContext: vi.fn(async () => renderJob),
        recordRenderError: vi.fn(async () => {}),
        recordOutputHash,
      },
      transitionNodeStatus: vi.fn(async (_nodeId, status) => {
        statuses.push(status)
      }),
      renderer,
      fabricateShot,
      advancePipeline: vi.fn(async () => statuses.push('advance')),
    })

    await harness.getHandler()?.({
      id: 'job-1',
      kind: 'render-shot',
      status: 'running',
      payload: { projectId: 'project-1', nodeId: 'node-1' },
      attempts: 1,
    })

    expect(fabricateShot).toHaveBeenCalledWith('project-1', 'node-1', 'job-1')
    expect(renderer.render).toHaveBeenCalledWith(renderJob)
    expect(recordOutputHash).toHaveBeenCalledWith('node-1', 'hash')
    expect(statuses).toEqual(['running', 'fabricate', 'success', 'advance'])
  })

  it('skips fabricateShot when a director-fabricate artifact already exists', async () => {
    const harness = createQueue()
    const fabricateShot = vi.fn(async () => {})
    const renderer = {
      render: vi.fn(async (): Promise<RenderResult> => ({
        shotId: 'S001',
        outputKey: 'render/S001.mp4',
        contentHash: 'hash',
      })),
    }
    registerRenderShotHandler(harness.queue, {
      repository: {
        hasFabricateArtifact: vi.fn(async () => true),
        loadRenderContext: vi.fn(async () => renderJob),
        recordRenderError: vi.fn(async () => {}),
      },
      transitionNodeStatus: vi.fn(async () => {}),
      renderer,
      fabricateShot,
      advancePipeline: vi.fn(async () => {}),
    })

    await harness.getHandler()?.({
      id: 'job-1',
      kind: 'render-shot',
      status: 'running',
      payload: { projectId: 'project-1', nodeId: 'node-1' },
      attempts: 1,
    })

    expect(fabricateShot).not.toHaveBeenCalled()
    expect(renderer.render).toHaveBeenCalledWith(renderJob)
  })

  it('records a Director FABRICATE error instead of a render error when fabricateShot fails', async () => {
    const harness = createQueue()
    const failure = new Error('FABRICATE 阶段失败')
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})
    const recordStageError = vi.fn(async () => {})
    const renderer = { render: vi.fn() }
    const loadRenderContext = vi.fn()
    registerRenderShotHandler(harness.queue, {
      repository: {
        hasFabricateArtifact: vi.fn(async () => false),
        loadRenderContext,
        recordRenderError,
        recordStageError,
      },
      transitionNodeStatus,
      renderer,
      fabricateShot: vi.fn(async () => {
        throw failure
      }),
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
    expect(recordRenderError).not.toHaveBeenCalled()
    expect(recordStageError).toHaveBeenCalledWith(
      'node-1',
      'FABRICATE',
      failure
    )
    expect(loadRenderContext).not.toHaveBeenCalled()
    expect(renderer.render).not.toHaveBeenCalled()
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
        hasFabricateArtifact: vi.fn(async () => true),
        loadRenderContext: vi.fn(async () => renderJob),
        recordRenderError,
      },
      transitionNodeStatus,
      renderer: { render: vi.fn(async () => { throw failure }) },
      fabricateShot: vi.fn(async () => {}),
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

  it('rejects an invalid fabricate artifact before automatic retry can reuse it', async () => {
    const harness = createQueue()
    const failure = new Error('shot 缺少 window.__CVC_RENDER__ runtime')
    const rejectFabricateArtifact = vi.fn(async () => {})
    registerRenderShotHandler(harness.queue, {
      repository: {
        hasFabricateArtifact: vi.fn(async () => true),
        loadRenderContext: vi.fn(async () => renderJob),
        recordRenderError: vi.fn(async () => {}),
        rejectFabricateArtifact,
      },
      transitionNodeStatus: vi.fn(async () => {}),
      renderer: { render: vi.fn(async () => { throw failure }) },
      fabricateShot: vi.fn(async () => {}),
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
    expect(rejectFabricateArtifact).toHaveBeenCalledWith(
      'project-1',
      'node-1',
    )
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
        hasFabricateArtifact: vi.fn(async () => true),
        loadRenderContext,
        recordRenderError,
      },
      transitionNodeStatus,
      renderer,
      fabricateShot: vi.fn(async () => {}),
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

  it('loads admission without requiring a job, marks pending, and enqueues on first run', async () => {
    const harness = createQueue()
    const order: string[] = []
    vi.mocked(harness.queue.enqueue).mockImplementation(async () => {
      order.push('enqueue')
      return 'job-1'
    })
    const assertAdmission = vi.fn(async () => {
      order.push('admission')
    })
    const jobId = await enqueueRenderShot(
      { projectId: 'project-1', nodeId: 'node-1' },
      {
        queue: harness.queue,
        loadAdmissionContext: vi.fn(async () => {
          order.push('load')
          return enqueueContext
        }),
        assertAdmission,
        captureInputFingerprint: vi.fn(async () => {
          order.push('fingerprint')
        }),
        transitionNodeStatus: vi.fn(async (_nodeId, status) => {
          order.push(status)
        }),
        recordRenderError: vi.fn(async () => {}),
      }
    )

    expect(jobId).toBe('job-1')
    // 首次入队没有已存在的 director-fabricate 产物：admission.job 为 null，
    // 不应触发 assertAdmission（那需要 htmlKey，首次还没有）。
    expect(order).toEqual(['load', 'fingerprint', 'pending', 'enqueue'])
    expect(assertAdmission).not.toHaveBeenCalled()
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      'render-shot',
      { projectId: 'project-1', nodeId: 'node-1' },
      { projectId: 'project-1', nodeId: 'node-1' }
    )
  })

  it('runs the runtime admission precheck when retrying with an existing artifact', async () => {
    const harness = createQueue()
    const order: string[] = []
    vi.mocked(harness.queue.enqueue).mockImplementation(async () => {
      order.push('enqueue')
      return 'job-1'
    })
    const assertAdmission = vi.fn(async () => {
      order.push('admission')
    })

    await enqueueRenderShot(
      { projectId: 'project-1', nodeId: 'node-1' },
      {
        queue: harness.queue,
        loadAdmissionContext: vi.fn(async () => {
          order.push('load')
          return retryAdmissionContext
        }),
        assertAdmission,
        transitionNodeStatus: vi.fn(async (_nodeId, status) => {
          order.push(status)
        }),
        recordRenderError: vi.fn(async () => {}),
      }
    )

    expect(order).toEqual(['load', 'admission', 'pending', 'enqueue'])
    expect(assertAdmission).toHaveBeenCalledWith(renderJob)
  })

  it('rejects runtime admission before pending or queue side effects', async () => {
    const harness = createQueue()
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})
    const rejectFabricateArtifact = vi.fn(async () => {})

    await expect(
      enqueueRenderShot(
        { projectId: 'project-1', nodeId: 'node-1' },
        {
          queue: harness.queue,
          loadAdmissionContext: vi.fn(async () => retryAdmissionContext),
          assertAdmission: vi.fn(async () => {
            throw new Error('shot 缺少 window.__CVC_RENDER__ runtime')
          }),
          transitionNodeStatus,
          recordRenderError,
          rejectFabricateArtifact,
        }
      )
    ).rejects.toThrow('shot 缺少 window.__CVC_RENDER__ runtime')
    // 失败发生在 pending 之前：节点仍是 idle，补偿必须走 idle -> pending -> running -> failed。
    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'pending',
      'running',
      'failed',
    ])
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(recordRenderError).toHaveBeenCalledWith('node-1', expect.any(Error))
    expect(rejectFabricateArtifact).toHaveBeenCalledWith(
      'project-1',
      'node-1',
    )
  })

  it('surfaces a failed admission load as a failed node instead of a silent idle', async () => {
    const harness = createQueue()
    const transitionNodeStatus = vi.fn(
      async (...args: [string, string]) => void args
    )
    const recordRenderError = vi.fn(async () => {})
    const assertAdmission = vi.fn()

    await expect(
      enqueueRenderShot(
        { projectId: 'project-1', nodeId: 'node-1' },
        {
          queue: harness.queue,
          loadAdmissionContext: vi.fn(async () => {
            throw new Error('项目内不存在节点：node-1')
          }),
          assertAdmission,
          transitionNodeStatus,
          recordRenderError,
        }
      )
    ).rejects.toThrow('项目内不存在节点')
    expect(assertAdmission).not.toHaveBeenCalled()
    // 之前的 bug：loadAdmissionContext 抛出的异常绕过补偿链，直接冒泡给
    // advance.ts 的通用 recordStageError（只写 directorError，不转 failed），
    // 导致节点永久停在 idle 且 Inspector 完全不展示错误。现在必须转 failed。
    expect(transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'pending',
      'running',
      'failed',
    ])
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(recordRenderError).toHaveBeenCalledWith('node-1', expect.any(Error))
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
          loadAdmissionContext: vi.fn(async () => enqueueContext),
          assertAdmission: vi.fn(async () => {}),
          transitionNodeStatus: vi.fn(async (_nodeId, status) => {
            statuses.push(status)
          }),
          recordRenderError,
        }
      )
    ).rejects.toThrow('队列写入失败')
    // 失败发生在队列写入阶段：pending 已经落地，补偿只需 running -> failed。
    expect(statuses).toEqual(['pending', 'running', 'failed'])
    expect(recordRenderError).toHaveBeenCalledWith('node-1', expect.any(Error))
  })

  it('rejects re-enqueue when the retry budget gate trips, before any queue write', async () => {
    const harness = createQueue()
    const statuses: string[] = []
    const recordRenderError = vi.fn(async () => {})
    const budgetError = new Error(
      '该环节在 30 分钟内已失败 5 次，已暂停重试；可稍后再试、修复配置或选择跳过'
    )

    await expect(
      enqueueRenderShot(
        { projectId: 'project-1', nodeId: 'node-1' },
        {
          queue: harness.queue,
          loadAdmissionContext: vi.fn(async () => enqueueContext),
          assertAdmission: vi.fn(async () => {}),
          transitionNodeStatus: vi.fn(async (_nodeId, status) => {
            statuses.push(status)
          }),
          recordRenderError,
          assertRetryBudget: vi.fn(async () => {
            throw budgetError
          }),
        }
      )
    ).rejects.toBe(budgetError)

    // 闸门只拦再次入队：不写队列行，走既有补偿链落节点 failed + renderError。
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(statuses).toEqual(['pending', 'running', 'failed'])
    expect(recordRenderError).toHaveBeenCalledWith('node-1', budgetError)
  })
})
