import { describe, expect, it, vi } from 'vitest'
import type { PipelineStage } from './types'
import {
  advancePipeline,
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
    isAutopilotEnabled: vi.fn(async () => true),
    listDownstreamCandidates: vi.fn(async () => candidates),
    areAllUpstreamsSuccessful: vi.fn(
      async (_projectId, nodeId) => ready[nodeId] ?? true
    ),
    recordStageError: vi.fn(async () => {}),
  }
  const enqueueDirectorStage =
    vi.fn<AdvanceDependencies['enqueueDirectorStage']>(async () => 'director-job')
  const enqueueRenderShot =
    vi.fn<AdvanceDependencies['enqueueRenderShot']>(async () => 'render-job')
  const prepareFinalExport =
    vi.fn<AdvanceDependencies['prepareFinalExport']>(async () => {})
  return {
    repository,
    enqueueDirectorStage,
    enqueueRenderShot,
    prepareFinalExport,
    dependencies: {
      repository,
      enqueueDirectorStage,
      enqueueRenderShot,
      prepareFinalExport,
    } satisfies AdvanceDependencies,
  }
}

describe('advancePipeline', () => {
  it('does nothing while project autopilot is disabled', async () => {
    const test = harness([candidate()])
    vi.mocked(test.repository.isAutopilotEnabled).mockResolvedValue(false)

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

    expect(test.enqueueRenderShot).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'codegen',
    })
    expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'subtitle',
      stage: 'ASSEMBLE',
    })
    expect(result.enqueuedNodeIds).toEqual(['codegen', 'subtitle'])
  })

  it('creates the trusted final MP4 before enqueuing export FINALIZE', async () => {
    const test = harness([
      candidate({ id: 'export', type: 'export', stage: 'FINALIZE' }),
    ])

    const result = await advancePipeline('project-1', 'score', test.dependencies)

    expect(test.prepareFinalExport).toHaveBeenCalledWith('project-1')
    expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'export',
      stage: 'FINALIZE',
    })
    expect(test.prepareFinalExport.mock.invocationCallOrder[0]).toBeLessThan(
      test.enqueueDirectorStage.mock.invocationCallOrder[0]!
    )
    expect(result.enqueuedNodeIds).toEqual(['export'])
  })

  it.each(['pending', 'running', 'success', 'failed', 'stale'] as const)(
    'does not enqueue a %s target',
    async (status) => {
      const test = harness([candidate({ status })])

      await advancePipeline('project-1', 'node-1', test.dependencies)

      expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
      expect(test.enqueueRenderShot).not.toHaveBeenCalled()
    }
  )

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
})

describe('startProjectPipeline', () => {
  it.each(['idle', 'failed', 'stale'] as const)(
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
        listSuccessfulNodeIds: vi.fn(async () => []),
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
        enqueuedNodeIds: ['ingest'],
        failedNodeIds: [],
      })
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
      listSuccessfulNodeIds: vi.fn(async () => ['ingest', 'direct']),
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
      enqueuedNodeIds: ['shot-2', 'shot-3'],
      failedNodeIds: ['bad'],
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
      listSuccessfulNodeIds: vi.fn(async () => []),
    }

    const result = await startProjectPipeline('project-1', {
      repository,
      enqueueDirectorStage: test.enqueueDirectorStage,
      advance: vi.fn(),
    })

    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
    expect(result.enqueuedNodeIds).toEqual([])
  })
})
