import { describe, expect, it, vi } from 'vitest'
import type { PositionedCanvasNode } from '@/features/canvas'
import type { ProjectExecutionSnapshot } from '@/features/projects'
import {
  applyExecutionSnapshotToNodes,
  ExecutionSnapshotRevisionGate,
  executionPollDelay,
  SingleFlightExecutionReader,
} from './project-execution-sync'

describe('project execution synchronization', () => {
  it('keeps active database polling independent from SSE health', () => {
    expect(executionPollDelay(true, 0)).toBe(1_500)
    expect(executionPollDelay(true, 1)).toBe(1_500)
    expect(executionPollDelay(true, 2)).toBe(3_000)
    expect(executionPollDelay(true, 8)).toBe(5_000)
    expect(executionPollDelay(false, 0)).toBeNull()
  })

  it('coalesces concurrent refresh hints into one database request', async () => {
    let resolve!: (value: ProjectExecutionSnapshot) => void
    const loader = vi.fn(() => new Promise<ProjectExecutionSnapshot>((done) => {
      resolve = done
    }))
    const reader = new SingleFlightExecutionReader()

    const first = reader.read(loader)
    const sseHint = reader.read(loader)
    resolve(snapshot())

    await expect(first).resolves.toMatchObject({ revision: 'a'.repeat(64) })
    await expect(sseHint).resolves.toMatchObject({ revision: 'a'.repeat(64) })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('prevents a slow response from replacing a newer adopted snapshot', () => {
    const gate = new ExecutionSnapshotRevisionGate()
    const slowRequest = gate.beginRequest()
    gate.supersedePendingRequests()

    expect(gate.shouldAccept(
      slowRequest,
      'b'.repeat(64),
      'a'.repeat(64),
    )).toBe(false)
  })

  it('projects database stages onto canvas nodes without waiting for SSE', () => {
    const [node] = applyExecutionSnapshotToNodes([websiteNode()], snapshot())

    expect(node.status).toBe('running')
    expect(node.data.websiteExecution).toMatchObject({
      phase: 'capture',
      state: 'running',
      enginePhase: 'capturing',
    })
  })
})

function websiteNode(): PositionedCanvasNode {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    type: 'website-stage',
    stage: 'INGEST',
    status: 'idle',
    laneKey: null,
    laneRole: null,
    contentHash: null,
    artifacts: [],
    data: { phase: 'capture' },
    position: { x: 0, y: 0 },
  }
}

function snapshot(): ProjectExecutionSnapshot {
  return {
    schemaVersion: 2,
    projectKind: 'website',
    workflowKind: 'website',
    state: 'running',
    active: true,
    canStart: false,
    canStop: true,
    attempt: {
      id: '00000000-0000-4000-8000-000000000201',
      status: 'running',
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
    currentStage: {
      nodeId: '00000000-0000-4000-8000-000000000301',
      phase: 'capture',
      enginePhase: 'capturing',
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
    currentWork: {
      nodeId: '00000000-0000-4000-8000-000000000301',
      logicalKey: 'website:capture',
      state: 'running',
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
    failure: null,
    recovery: { canStart: false, canStop: true, mode: 'stop' },
    detail: {
      kind: 'website',
      stages: [{
        nodeId: '00000000-0000-4000-8000-000000000301',
        phase: 'capture',
        state: 'running',
        enginePhase: 'capturing',
        updatedAt: '2026-07-30T00:00:00.000Z',
      }],
    },
    stages: [{
      nodeId: '00000000-0000-4000-8000-000000000301',
      phase: 'capture',
      state: 'running',
      enginePhase: 'capturing',
      updatedAt: '2026-07-30T00:00:00.000Z',
    }],
    delivery: null,
    revision: 'a'.repeat(64),
  }
}
