import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraph, CanvasGraphNode } from '@/features/canvas'
import { executeNodeAction, type NodeRecoveryDependencies } from './recovery'

vi.mock('server-only', () => ({}))

describe('executeNodeAction', () => {
  it('repairs the invalid successful shot contract before retrying S002 codegen', async () => {
    const test = harness(false)

    const result = await executeNodeAction(
      { projectId: 'project-1', nodeId: 'codegen-s002', intent: 'repair' },
      test.dependencies
    )

    expect(test.invalidate).toHaveBeenCalledWith(
      'script-s002',
      'repair-upstream'
    )
    expect(test.enqueueDirectorStage).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'script-s002',
      stage: 'SHOT_SPEC',
    })
    expect(test.enqueueRenderShot).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      action: 'repair-upstream',
      requestedNodeId: 'codegen-s002',
      queuedNodeId: 'script-s002',
      jobId: 'director-job',
    })
  })

  it('retries codegen directly when the S002 shot contract is valid', async () => {
    const test = harness(true)

    const result = await executeNodeAction(
      { projectId: 'project-1', nodeId: 'codegen-s002', intent: 'repair' },
      test.dependencies
    )

    expect(test.invalidate).not.toHaveBeenCalled()
    expect(test.enqueueRenderShot).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'codegen-s002',
    })
    expect(result.action).toBe('execute')
  })

  it('forces a new render version for a successful codegen node', async () => {
    const test = harness(true, 'success')

    const result = await executeNodeAction(
      { projectId: 'project-1', nodeId: 'codegen-s002', intent: 'rerender' },
      test.dependencies
    )

    expect(test.invalidate).toHaveBeenCalledWith(
      'codegen-s002',
      'manual-regenerate'
    )
    expect(test.enqueueRenderShot).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'codegen-s002',
      forceRender: true,
    })
    expect(result.action).toBe('rerender')
  })

  it('does not retry a non-retryable configuration failure', async () => {
    const test = harness(true)
    test.graph.nodes[1] = node({
      id: 'codegen-s002',
      type: 'shot-codegen',
      stage: 'FABRICATE',
      status: 'failed',
      laneKey: 'S002',
      directorError: {
        stage: 'FABRICATE',
        message: '配置不可用',
        code: 'CONFIGURATION_BLOCKED',
        retryable: false,
      },
    })

    await expect(
      executeNodeAction(
        { projectId: 'project-1', nodeId: 'codegen-s002', intent: 'repair' },
        test.dependencies
      )
    ).rejects.toThrow('项目设置')
    expect(test.enqueueRenderShot).not.toHaveBeenCalled()
  })
})

function harness(shotSpecValid: boolean, codegenStatus: CanvasGraphNode['status'] = 'failed') {
  const graph: CanvasGraph = {
    nodes: [
      node({
        id: 'script-s002',
        type: 'shot-script',
        stage: 'SHOT_SPEC',
        status: 'success',
        laneKey: 'S002',
        data: { sourceUnitId: 'U002' },
      }),
      node({
        id: 'codegen-s002',
        type: 'shot-codegen',
        stage: 'FABRICATE',
        status: codegenStatus,
        laneKey: 'S002',
      }),
    ],
    edges: [{ id: 'edge-1', source: 'script-s002', target: 'codegen-s002' }],
  }
  const invalidate = vi.fn(async () => {})
  const enqueueDirectorStage = vi.fn(async () => 'director-job')
  const enqueueRenderShot = vi.fn(async () => 'render-job')
  const dependencies: NodeRecoveryDependencies = {
    getGraph: vi.fn(async () => graph),
    setAutopilot: vi.fn(async () => {}),
    inspectShotSpec: vi.fn(async () => shotSpecValid),
    invalidate,
    enqueueDirectorStage,
    enqueueRenderShot,
  }
  return {
    graph,
    invalidate,
    enqueueDirectorStage,
    enqueueRenderShot,
    dependencies,
  }
}

function node(
  overrides: Partial<CanvasGraphNode> & Pick<CanvasGraphNode, 'id' | 'type'>
): CanvasGraphNode {
  return {
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
