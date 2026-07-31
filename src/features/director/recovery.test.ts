import { describe, expect, it, vi } from 'vitest'
import type { CanvasGraph, CanvasGraphNode } from '@/features/canvas'
import {
  executeNodeAction,
  repairProjectFrontier,
  type NodeRecoveryDependencies,
} from './recovery'

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

  it('forces a new FABRICATE version and carries a bounded revision brief', async () => {
    const test = harness(true, 'success')

    const result = await executeNodeAction(
      {
        projectId: 'project-1',
        nodeId: 'codegen-s002',
        intent: 'regenerate',
        revisionBrief: '主视觉改成俯视构图',
      },
      test.dependencies,
    )

    expect(test.invalidate).toHaveBeenCalledWith(
      'codegen-s002',
      'manual-regenerate',
    )
    expect(test.enqueueRenderShot).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'codegen-s002',
      regenerateSource: true,
      revisionBrief: '主视觉改成俯视构图',
    })
    expect(result).toMatchObject({
      action: 'regenerate',
      message: '已按修改要求排队重新生成分镜代码与视频',
    })
  })

  it('rejects a revision brief for non-codegen nodes', async () => {
    const test = harness(true, 'success')

    await expect(
      executeNodeAction(
        {
          projectId: 'project-1',
          nodeId: 'script-s002',
          intent: 'regenerate',
          revisionBrief: '改变画面',
        },
        test.dependencies,
      ),
    ).rejects.toThrow('定向修改仅支持重新生成镜头代码')
    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
    expect(test.enqueueRenderShot).not.toHaveBeenCalled()
  })

  it('allows one explicit repair after a configuration failure', async () => {
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
    ).resolves.toMatchObject({ action: 'execute', queuedNodeId: 'codegen-s002' })
    expect(test.enqueueRenderShot).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'codegen-s002',
    })
  })

  it('routes a blocked export to confirmation without enqueuing Director FINALIZE', async () => {
    const test = harness(true)
    test.graph.nodes.push(node({
      id: 'export',
      type: 'export',
      stage: 'FINALIZE',
      status: 'blocked',
      workflowBlock: {
        code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
        message: '当前终片需要使用占位镜头，请确认降级交付。',
        recovery: 'confirm_degraded_export',
        referenceId: 'ref-1',
        blockedAt: '2026-07-29T06:25:05.000Z',
        confirmationFingerprint: 'sha256:current',
      },
    }))

    const result = await executeNodeAction(
      { projectId: 'project-1', nodeId: 'export', intent: 'execute' },
      test.dependencies,
    )

    expect(test.requestExportFinalization).toHaveBeenCalledWith({
      projectId: 'project-1',
      exportNodeId: 'export',
      trigger: 'manual-node',
    })
    expect(test.enqueueDirectorStage).not.toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'export' }),
    )
    expect(result).toMatchObject({
      action: 'confirm-degraded-export',
      requestedNodeId: 'export',
      jobId: null,
    })
  })
})

describe('repairProjectFrontier', () => {
  it('repairs a historical invalid shot producer before normal project advancement', async () => {
    const test = harness(false)
    test.graph.nodes[1]!.directorError = {
      stage: 'FABRICATE',
      message: '上游镜头合同需要修复',
      code: 'UPSTREAM_ARTIFACT_INVALID',
      retryable: true,
    }

    const result = await repairProjectFrontier('project-1', test.dependencies)

    expect(result).toMatchObject({
      enqueuedNodeIds: ['script-s002'],
      repairRootNodeIds: ['script-s002'],
      handledSuccessfulNodeIds: ['script-s002'],
      blockedNodes: [],
    })
    expect(test.invalidate).toHaveBeenCalledWith(
      'script-s002',
      'repair-upstream'
    )
    expect(test.dependencies.enableAutomaticAdvance).not.toHaveBeenCalled()
  })

  it('does not automatically repair a failed frontier without retryable=true', async () => {
    const test = harness(false)

    const result = await repairProjectFrontier('project-1', test.dependencies)

    expect(result.enqueuedNodeIds).toEqual([])
    expect(result.repairRootNodeIds).toEqual([])
    expect(result.blockedNodes).toContainEqual({
      nodeId: 'codegen-s002',
      code: 'CONFIGURATION_BLOCKED',
      message: '失败节点缺少可重试标记，需要手动处理',
    })
    expect(test.invalidate).not.toHaveBeenCalled()
    expect(test.enqueueDirectorStage).not.toHaveBeenCalled()
  })

  it('reports every failed non-retryable node as blocked without re-enqueueing it', async () => {
    const test = harness(true)
    test.graph.nodes.push(node({
      id: 'export',
      type: 'export',
      stage: 'FINALIZE',
      status: 'failed',
      directorError: {
        stage: 'FINALIZE',
        message: '模型路由合同无效',
        code: 'ROUTE_CONTRACT_INVALID',
        retryable: false,
      },
    }))

    const result = await repairProjectFrontier('project-1', test.dependencies)

    expect(result.blockedNodes).toContainEqual({
      nodeId: 'export',
      code: 'ROUTE_CONTRACT_INVALID',
      message: '模型路由合同无效',
    })
    expect(test.enqueueDirectorStage).not.toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'export' })
    )
  })

  it('reconciles only a legacy generic export failure into the confirmation block', async () => {
    const test = harness(true)
    test.graph.nodes.push(node({
      id: 'export',
      type: 'export',
      stage: 'FINALIZE',
      status: 'failed',
      directorError: {
        stage: 'FINALIZE',
        message: '执行遇到未知问题',
        code: 'STAGE_FAILED',
        retryable: true,
      },
    }))

    const result = await repairProjectFrontier('project-1', test.dependencies)

    expect(test.requestExportFinalization).toHaveBeenCalledWith({
      projectId: 'project-1',
      exportNodeId: 'export',
      trigger: 'manual-node',
    })
    expect(result.blockedNodes).toContainEqual({
      nodeId: 'export',
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
      message: '当前终片需要使用占位镜头，请确认降级交付。',
    })
    expect(test.enqueueDirectorStage).not.toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'export' }),
    )
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
  const requestExportFinalization = vi.fn(async () => ({
    status: 'blocked' as const,
    nodeId: 'export',
    block: {
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED' as const,
      message: '当前终片需要使用占位镜头，请确认降级交付。',
      recovery: 'confirm_degraded_export' as const,
      referenceId: 'ref-1',
      blockedAt: '2026-07-29T06:25:05.000Z',
      confirmationFingerprint: 'sha256:current',
    },
  }))
  const dependencies: NodeRecoveryDependencies = {
    getGraph: vi.fn(async () => graph),
    enableAutomaticAdvance: vi.fn(async () => {}),
    inspectShotSpec: vi.fn(async () => shotSpecValid),
    invalidate,
    enqueueDirectorStage,
    enqueueRenderShot,
    requestExportFinalization,
  }
  return {
    graph,
    invalidate,
    enqueueDirectorStage,
    enqueueRenderShot,
    requestExportFinalization,
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
