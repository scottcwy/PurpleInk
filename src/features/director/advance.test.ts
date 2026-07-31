import { describe, expect, it, vi } from 'vitest'
import { AutomaticAdvanceDisabledError } from '@/lib/queue'
import type { PipelineStage } from './types'
import {
  advancePipeline,
  resumeProjectPipeline,
  startProjectPipeline,
  type AdvanceCandidate,
  type AdvanceDependencies,
} from './advance'

vi.mock('server-only', () => ({}))

function candidate(
  overrides: Partial<AdvanceCandidate> = {}
): AdvanceCandidate {
  return {
    id: 'node-2',
    type: 'shot-script',
    stage: 'SHOT_SPEC',
    status: 'idle',
    ...overrides,
  }
}

function harness(
  candidates: AdvanceCandidate[],
  ready: Record<string, boolean> = {}
) {
  const repository: AdvanceDependencies['repository'] = {
    isAutomaticAdvanceEnabled: vi.fn(async () => true),
    listDownstreamCandidates: vi.fn(async () => candidates),
    areAllUpstreamsSuccessful: vi.fn(
      async (_projectId, nodeId) => ready[nodeId] ?? true
    ),
    isNodeStale: vi.fn(async () => false),
    markNodeStale: vi.fn(async () => {}),
    isMediaReady: vi.fn(async () => true),
    recordStageError: vi.fn(async () => {}),
  }
  const enqueueDirectorStage =
    vi.fn<AdvanceDependencies['enqueueDirectorStage']>(async () => 'director-job')
  const enqueueRenderShot =
    vi.fn<AdvanceDependencies['enqueueRenderShot']>(async () => 'render-job')
  const requestExportFinalization =
    vi.fn<AdvanceDependencies['requestExportFinalization']>(async (input) => ({
      status: 'queued',
      nodeId: input.exportNodeId,
      jobId: 'export-job',
      mode: 'complete',
    }))
  return {
    repository,
    enqueueDirectorStage,
    enqueueRenderShot,
    requestExportFinalization,
    dependencies: {
      repository,
      enqueueDirectorStage,
      enqueueRenderShot,
      requestExportFinalization,
    } satisfies AdvanceDependencies,
  }
}

describe('advancePipeline', () => {
  it('does nothing while project autopilot is disabled', async () => {
    const test = harness([candidate()])
    vi.mocked(test.repository.isAutomaticAdvanceEnabled).mockResolvedValue(false)

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result).toEqual({ enqueuedNodeIds: [], failedNodeIds: [] })
    expect(test.repository.listDownstreamCandidates).not.toHaveBeenCalled()
    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
  })

  it('waits for every inbound node before enqueuing a multi-input target', async () => {
    const test = harness([candidate({ id: 'score', type: 'score', stage: 'ASSEMBLE' })], {
      score: false,
    })

    const result = await advancePipeline('project-1', 'shot-qa-1', test.dependencies)

    expect(result.enqueuedNodeIds).toEqual([])
    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
  })

  it('routes render and Director nodes through their own enqueue services', async () => {
    const test = harness([
      candidate({ id: 'codegen', type: 'shot-codegen', stage: 'FABRICATE' }),
      candidate({ id: 'subtitle', type: 'shot-subtitle', stage: 'ASSEMBLE' }),
    ])

    const result = await advancePipeline('project-1', 'shot-script', test.dependencies)

    expect(test.enqueueRenderShot).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        nodeId: 'codegen',
      },
      { requireAutomaticAdvance: true },
    )
    expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'subtitle',
      stage: 'ASSEMBLE',
    })
    expect(result.enqueuedNodeIds).toEqual(['codegen', 'subtitle'])
  })

  it('keeps codegen idle while asynchronous narration is not ready', async () => {
    const test = harness([
      candidate({ id: 'codegen', type: 'shot-codegen', stage: 'FABRICATE' }),
    ])
    vi.mocked(test.repository.isMediaReady).mockResolvedValue(false)

    const result = await advancePipeline('project-1', 'shot-script', test.dependencies)

    expect(result).toEqual({ enqueuedNodeIds: [], failedNodeIds: [] })
    expect(test.enqueueRenderShot).not.toHaveBeenCalled()
    expect(test.repository.recordStageError).not.toHaveBeenCalled()
  })

  it('routes export through the single finalization coordinator', async () => {
    const test = harness([
      candidate({ id: 'export', type: 'export', stage: 'FINALIZE' }),
    ])

    const result = await advancePipeline('project-1', 'score', test.dependencies)

    expect(test.requestExportFinalization).toHaveBeenCalledWith({
      projectId: 'project-1',
      exportNodeId: 'export',
      trigger: 'autopilot',
    })
    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
    expect(result.enqueuedNodeIds).toEqual(['export'])
  })

  it('returns an explicit confirmation block without recording a stage failure', async () => {
    const test = harness([
      candidate({ id: 'export', type: 'export', stage: 'FINALIZE' }),
    ])
    test.requestExportFinalization.mockResolvedValue({
      status: 'blocked',
      nodeId: 'export',
      block: {
        code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
        message: '当前终片需要使用占位镜头，请确认降级交付。',
        recovery: 'confirm_degraded_export',
        referenceId: 'ref-1',
        blockedAt: '2026-07-29T06:25:05.000Z',
        confirmationFingerprint: 'sha256:current',
      },
    })

    const result = await advancePipeline('project-1', 'score', test.dependencies)

    expect(result.enqueuedNodeIds).toEqual([])
    expect(result.failedNodeIds).toEqual([])
    expect(result.blockedNodes).toEqual([{
      nodeId: 'export',
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
      message: '当前终片需要使用占位镜头，请确认降级交付。',
    }])
    expect(test.repository.recordStageError).not.toHaveBeenCalled()
  })

  it.each(['pending', 'running', 'success'] as const)(
    'does not enqueue a %s target',
    async (status) => {
      const test = harness([candidate({ status })])

      await advancePipeline('project-1', 'node-1', test.dependencies)

      expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
      expect(test.enqueueRenderShot).not.toHaveBeenCalled()
    }
  )

  it('re-enqueues a ready stale target exactly once when autopilot advances', async () => {
    const test = harness([candidate({ status: 'stale' })])

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result.enqueuedNodeIds).toEqual(['node-2'])
    expect(test.enqueueDirectorStage).toHaveBeenCalledOnce()
  })

  it('re-enqueues a ready failed target only when retryable is explicitly true', async () => {
    const test = harness([
      candidate({ status: 'failed', retryable: true }),
    ])

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result.enqueuedNodeIds).toEqual(['node-2'])
    expect(test.enqueueDirectorStage).toHaveBeenCalledOnce()
  })

  it.each([false, undefined])(
    'does not automatically retry a failed target with retryable=%s',
    async (retryable) => {
      const test = harness([
        candidate({ status: 'failed', retryable }),
      ])

      const result = await advancePipeline('project-1', 'node-1', test.dependencies)

      expect(result).toEqual({ enqueuedNodeIds: [], failedNodeIds: [] })
      expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
      expect(test.enqueueRenderShot).not.toHaveBeenCalled()
    }
  )

  it('does not let a ready sibling branch re-enqueue a failed target without retryable=true', async () => {
    const test = harness([
      candidate({ id: 'blocked', status: 'failed', retryable: undefined }),
      candidate({ id: 'ready', status: 'idle' }),
    ])

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result.enqueuedNodeIds).toEqual(['ready'])
    expect(test.enqueueDirectorStage).toHaveBeenCalledOnce()
    expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'ready',
      stage: 'SHOT_SPEC',
    })
  })

  it('marks a succeeded target stale and re-enqueues it when its inputs changed', async () => {
    const test = harness([candidate({ status: 'success' })])
    vi.mocked(test.repository.isNodeStale).mockResolvedValue(true)

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(test.repository.markNodeStale).toHaveBeenCalledWith('node-2')
    expect(result.enqueuedNodeIds).toEqual(['node-2'])
  })

  it('records one enqueue failure and continues other ready branches', async () => {
    const test = harness([
      candidate({ id: 'bad', stage: 'SHOT_SPEC' }),
      candidate({ id: 'good', stage: 'ASSEMBLE' }),
    ])
    test.enqueueDirectorStage.mockImplementation(
      async (input: { stage: PipelineStage }) => {
        if (input.stage === 'SHOT_SPEC') throw new Error('队列拒绝')
        return 'director-job'
      }
    )

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result).toEqual({
      enqueuedNodeIds: ['good'],
      failedNodeIds: ['bad'],
    })
    expect(test.repository.recordStageError).toHaveBeenCalledWith(
      'bad',
      'SHOT_SPEC',
      expect.any(Error)
    )
  })

  it('awaits render admission failure and continues other ready branches', async () => {
    const test = harness([
      candidate({
        id: 'codegen',
        type: 'shot-codegen',
        stage: 'FABRICATE',
      }),
      candidate({ id: 'good', stage: 'ASSEMBLE' }),
    ])
    const failure = new Error('runtime admission 失败')
    test.enqueueRenderShot.mockRejectedValueOnce(failure)

    const result = await advancePipeline(
      'project-1',
      'shot-script',
      test.dependencies
    )

    expect(result).toEqual({
      enqueuedNodeIds: ['good'],
      failedNodeIds: ['codegen'],
    })
    expect(test.repository.recordStageError).toHaveBeenCalledWith(
      'codegen',
      'FABRICATE',
      failure
    )
    expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'good',
      stage: 'ASSEMBLE',
    })
  })

  it('skips a candidate whose persisted stage is absent', async () => {
    const test = harness([candidate({ stage: null })])

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result).toEqual({ enqueuedNodeIds: [], failedNodeIds: [] })
    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
  })

  it('does not report a stop race as a workflow failure', async () => {
    const test = harness([candidate({ id: 'stopped', stage: 'SHOT_SPEC' })])
    test.enqueueDirectorStage.mockRejectedValue(
      new AutomaticAdvanceDisabledError(),
    )

    const result = await advancePipeline('project-1', 'node-1', test.dependencies)

    expect(result).toEqual({ enqueuedNodeIds: [], failedNodeIds: [] })
    expect(test.repository.recordStageError).not.toHaveBeenCalled()
  })
})

describe('startProjectPipeline', () => {
  it('rechecks the persisted control latch under the resume lock before enqueueing', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'success',
        }),
      ),
      listCompletedNodeIds: vi.fn(async () => ['ingest']),
    }
    const advance = vi.fn(async () => ({
      enqueuedNodeIds: ['next'],
      failedNodeIds: [],
    }))

    const result = await resumeProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance,
      withResumeControl: vi.fn(async () => null),
    })

    expect(advance).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'blocked',
      enqueuedNodeIds: [],
      repairRootNodeIds: [],
      failedNodeIds: [],
      blockedNodes: [{
        nodeId: 'project-1',
        code: 'AUTOMATIC_ADVANCE_DISABLED',
        message: '项目自动推进已停止',
      }],
    })
  })

  it('resumes an established frontier without mutating the script autopilot latch', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'pending',
        }),
      ),
      listCompletedNodeIds: vi.fn(async () => ['ingest']),
    }

    await resumeProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(async () => ({ enqueuedNodeIds: [], failedNodeIds: [] })),
    })

    expect(repository.setAutopilot).not.toHaveBeenCalled()
  })

  it.each(['idle', 'stale'] as const)(
    'enqueues the trusted INGEST entry when it is %s',
    async (status) => {
      const test = harness([])
      const repository = {
        ...test.repository,
        setAutopilot: vi.fn(async () => true),
        getEntryNode: vi.fn(async () =>
          candidate({
            id: 'ingest',
            type: 'script-import',
            stage: 'INGEST',
            status,
          })
        ),
        listCompletedNodeIds: vi.fn(async () => []),
      }

      const result = await startProjectPipeline('project-1', {
        repository,
        enqueueDirectorStage: test.enqueueDirectorStage,
        advance: vi.fn(),
      })

      expect(repository.setAutopilot).toHaveBeenCalledWith('project-1', true)
      expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
        projectId: 'project-1',
        nodeId: 'ingest',
        stage: 'INGEST',
      })
      expect(result).toEqual({
        autopilot: true,
        status: 'started',
        enqueuedNodeIds: ['ingest'],
        repairRootNodeIds: [],
        failedNodeIds: [],
        blockedNodes: [],
      })
    }
  )

  it('re-enqueues a failed INGEST entry when retryable is explicitly true', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'failed',
          retryable: true,
        })
      ),
      listCompletedNodeIds: vi.fn(async () => []),
    }

    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(),
    })

    expect(test.enqueueDirectorStage).toHaveBeenCalledOnce()
    expect(result.status).toBe('started')
    expect(result.enqueuedNodeIds).toEqual(['ingest'])
  })

  it('recovers a queued INGEST entry when no active attempt exists', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'pending',
        }),
      ),
      findActiveAttempt: vi.fn(async () => null),
      listCompletedNodeIds: vi.fn(async () => []),
    }

    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(),
    })

    expect(test.enqueueDirectorStage).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        nodeId: 'ingest',
        stage: 'INGEST',
      },
      { preservePending: true },
    )
    expect(result.status).toBe('started')
  })

  it('reuses a queued INGEST entry when its active attempt still exists', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'pending',
        }),
      ),
      findActiveAttempt: vi.fn(async () => ({
        attemptId: 'attempt-active',
        status: 'queued' as const,
        reused: true,
      })),
      listCompletedNodeIds: vi.fn(async () => []),
    }

    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(),
    })

    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
    expect(result.status).toBe('reused')
    expect(result.enqueuedNodeIds).toEqual(['ingest'])
    expect(result).toMatchObject({
      jobId: 'attempt-active',
      attemptStatus: 'queued',
      reused: true,
    })
  })

  it.each([false, undefined])(
    'keeps a failed INGEST entry blocked with retryable=%s',
    async (retryable) => {
      const test = harness([])
      const repository = {
        ...test.repository,
        setAutopilot: vi.fn(async () => true),
        getEntryNode: vi.fn(async () =>
          candidate({
            id: 'ingest',
            type: 'script-import',
            stage: 'INGEST',
            status: 'failed',
            retryable,
          })
        ),
        listCompletedNodeIds: vi.fn(async () => []),
      }

      const result = await startProjectPipeline('project-1', {
        repository,
        enqueueDirectorStage: test.enqueueDirectorStage,
        advance: vi.fn(),
      })

      expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
      expect(result.status).toBe('blocked')
      expect(result.blockedNodes).toEqual([
        {
          nodeId: 'ingest',
          code: 'QUEUE_FAILED',
          message: '项目尚未完成，但当前没有可入队节点',
        },
      ])
    }
  )

  it('resumes from all successful nodes and de-duplicates their ready targets', async () => {
    const test = harness([])
    const advance = vi
      .fn()
      .mockResolvedValueOnce({
        enqueuedNodeIds: ['shot-2'],
        failedNodeIds: [],
      })
      .mockResolvedValueOnce({
        enqueuedNodeIds: ['shot-2', 'shot-3'],
        failedNodeIds: ['bad'],
      })
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'success',
        })
      ),
      listCompletedNodeIds: vi.fn(async () => ['ingest', 'direct']),
    }

    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance,
    })

    expect(advance.mock.calls).toEqual([
      ['project-1', 'ingest'],
      ['project-1', 'direct'],
    ])
    expect(result).toEqual({
      autopilot: true,
      status: 'started',
      enqueuedNodeIds: ['shot-2', 'shot-3'],
      repairRootNodeIds: [],
      failedNodeIds: ['bad'],
      blockedNodes: [],
    })
  })

  it('does not enqueue again while the entry is already pending', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'pending',
        })
      ),
      listCompletedNodeIds: vi.fn(async () => []),
    }

    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(),
    })

    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
    expect(result.enqueuedNodeIds).toEqual([])
    expect(result.status).toBe('blocked')
    expect(result.blockedNodes).toEqual([
      {
        nodeId: 'ingest',
        code: 'QUEUE_FAILED',
        message: '项目尚未完成，但当前没有可入队节点',
      },
    ])
  })

  it('reports complete instead of a false start when every node succeeded', async () => {
    const test = harness([])
    const repository = {
      ...test.repository,
      setAutopilot: vi.fn(async () => true),
      getEntryNode: vi.fn(async () =>
        candidate({
          id: 'ingest',
          type: 'script-import',
          stage: 'INGEST',
          status: 'success',
        })
      ),
      listCompletedNodeIds: vi.fn(async () => ['ingest']),
      isProjectComplete: vi.fn(async () => true),
    }
    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(async () => ({ enqueuedNodeIds: [], failedNodeIds: [] })),
    })
    expect(result.status).toBe('complete')
    expect(result.blockedNodes).toEqual([])
  })
})
