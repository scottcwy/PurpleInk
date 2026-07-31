import { describe, expect, it, vi } from 'vitest'
import {
  getProjectExecution,
  parseProjectExecutionSnapshot,
} from './execution-client'

describe('project execution client', () => {
  it('accepts the declared safe snapshot and ignores no hidden provider fields', () => {
    expect(parseProjectExecutionSnapshot(snapshot())).toMatchObject({
      schemaVersion: 2,
      projectKind: 'website',
      workflowKind: 'website',
      state: 'running',
      currentStage: { phase: 'capture', enginePhase: 'capturing' },
      stages: [{ phase: 'capture', state: 'running' }],
    })
  })

  it('rejects a malformed snapshot instead of fabricating an execution state', () => {
    expect(() => parseProjectExecutionSnapshot({
      ...snapshot(),
      revision: 'not-a-revision',
    })).toThrow('项目执行状态响应无效')
  })

  it('rejects a v2 detail branch that disagrees with the project kind', () => {
    expect(() => parseProjectExecutionSnapshot({
      ...snapshot(),
      detail: { kind: 'script', director: [], fanOut: {
        shotCount: 0,
        completedShotCount: 0,
        shots: [],
      }, merge: null, export: null },
    })).toThrow('项目执行状态响应无效')
  })

  it('reads the database snapshot through the dedicated authenticated route', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, execution: snapshot() }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await expect(getProjectExecution('project id', fetcher)).resolves.toMatchObject({
      state: 'running',
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/projects/project%20id/execution',
      { cache: 'no-store' },
    )
  })
})

function snapshot() {
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
