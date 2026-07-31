import { describe, expect, it, vi } from 'vitest'
import { AutomaticAdvanceDisabledError } from '@/lib/queue'

vi.mock('server-only', () => ({}))

import {
  requestExportFinalization,
  StaleDegradedConfirmationError,
  type ExportFinalizationDependencies,
} from './export-finalization'

const exportNode = {
  id: 'export-node',
  type: 'export' as const,
  status: 'failed' as const,
  stage: 'FINALIZE',
  contentHash: null,
  data: {},
  laneKey: null,
  laneRole: null,
  artifacts: [],
}

function harness(overrides: {
  ready?: boolean
  degradedReady?: boolean
  confirmationFingerprint?: string | null
  status?: typeof exportNode.status | 'idle' | 'blocked'
} = {}) {
  const node = { ...exportNode, status: overrides.status ?? exportNode.status }
  const transitionNodeStatus = vi.fn(
    async (_nodeId: string, _status: string) => {},
  )
  const enqueueProjectExport = vi.fn(async () => 'export-job')
  const dependencies: ExportFinalizationDependencies = {
    getGraph: vi.fn(async () => ({ nodes: [node], edges: [] })),
    getReadiness: vi.fn(async () => ({
      ready: overrides.ready ?? false,
      degradedReady: overrides.degradedReady ?? true,
      confirmationFingerprint:
        overrides.confirmationFingerprint === undefined
          ? 'sha256:current'
          : overrides.confirmationFingerprint,
      finalArtifactId: null,
    })),
    transitionNodeStatus,
    enqueueProjectExport,
    now: () => new Date('2026-07-29T06:25:05.000Z'),
    referenceId: () => 'block-ref',
  }
  return { dependencies, transitionNodeStatus, enqueueProjectExport }
}

describe('requestExportFinalization', () => {
  it('blocks a degradable export without creating an export or Director attempt', async () => {
    const test = harness()

    const result = await requestExportFinalization({
      projectId: 'project-1',
      exportNodeId: 'export-node',
      trigger: 'autopilot',
    }, test.dependencies)

    expect(result).toEqual({
      status: 'blocked',
      nodeId: 'export-node',
      block: {
        code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
        message: '当前终片需要使用占位镜头，请确认降级交付。',
        recovery: 'confirm_degraded_export',
        referenceId: 'block-ref',
        blockedAt: '2026-07-29T06:25:05.000Z',
        confirmationFingerprint: 'sha256:current',
      },
    })
    expect(test.transitionNodeStatus).toHaveBeenCalledWith(
      'export-node',
      'blocked',
      { workflowBlock: result.status === 'blocked' ? result.block : undefined },
    )
    expect(test.enqueueProjectExport).not.toHaveBeenCalled()
  })

  it('rejects a stale degraded confirmation without changing state', async () => {
    const test = harness({ status: 'blocked' })

    await expect(requestExportFinalization({
      projectId: 'project-1',
      exportNodeId: 'export-node',
      trigger: 'confirmed-degraded',
      confirmationFingerprint: 'sha256:stale',
    }, test.dependencies)).rejects.toBeInstanceOf(StaleDegradedConfirmationError)

    expect(test.transitionNodeStatus).not.toHaveBeenCalled()
    expect(test.enqueueProjectExport).not.toHaveBeenCalled()
  })

  it('queues a confirmed degraded export and clears the confirmation block', async () => {
    const test = harness({ status: 'blocked' })

    const result = await requestExportFinalization({
      projectId: 'project-1',
      exportNodeId: 'export-node',
      trigger: 'confirmed-degraded',
      confirmationFingerprint: 'sha256:current',
    }, test.dependencies)

    expect(test.transitionNodeStatus).toHaveBeenCalledWith('export-node', 'pending')
    expect(test.enqueueProjectExport).toHaveBeenCalledWith({
      projectId: 'project-1',
      degraded: true,
      exportNodeId: 'export-node',
      confirmationFingerprint: 'sha256:current',
      inputFingerprint: 'sha256:current',
    })
    expect(result).toEqual({
      status: 'queued',
      nodeId: 'export-node',
      jobId: 'export-job',
      mode: 'degraded',
    })
  })

  it('queues a normal export through the same entrypoint', async () => {
    const test = harness({
      ready: true,
      degradedReady: false,
      confirmationFingerprint: null,
      status: 'idle',
    })

    const result = await requestExportFinalization({
      projectId: 'project-1',
      exportNodeId: 'export-node',
      trigger: 'autopilot',
    }, test.dependencies)

    expect(test.transitionNodeStatus).toHaveBeenCalledWith('export-node', 'pending')
    expect(test.enqueueProjectExport).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        exportNodeId: 'export-node',
      },
      { requireAutomaticAdvance: true },
    )
    expect(result.status).toBe('queued')
  })

  it('cancels the queued export projection when stop wins the enqueue race', async () => {
    const test = harness({
      ready: true,
      degradedReady: false,
      confirmationFingerprint: null,
      status: 'idle',
    })
    test.enqueueProjectExport.mockRejectedValue(
      new AutomaticAdvanceDisabledError(),
    )

    await expect(requestExportFinalization({
      projectId: 'project-1',
      exportNodeId: 'export-node',
      trigger: 'autopilot',
    }, test.dependencies)).rejects.toBeInstanceOf(AutomaticAdvanceDisabledError)

    expect(test.transitionNodeStatus.mock.calls.map((call) => call[1])).toEqual([
      'pending',
      'cancelled',
    ])
    expect(test.transitionNodeStatus).toHaveBeenLastCalledWith(
      'export-node',
      'cancelled',
      { idempotent: true },
    )
  })
})
