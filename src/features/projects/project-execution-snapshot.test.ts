import { describe, expect, it, vi } from 'vitest'
import {
  deriveProjectExecutionSnapshot,
  type ProjectExecutionFacts,
} from './project-execution-snapshot'

vi.mock('server-only', () => ({}))

const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'

describe('deriveProjectExecutionSnapshot', () => {
  it('reports succeeded only when attempt, stages, verification, and approved artifact agree', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      attempt: attempt('succeeded'),
      nodes: websiteNodes('succeeded', passedExecution()),
      artifact: artifact('approved'),
    }))

    expect(snapshot.state).toBe('succeeded')
    expect(snapshot.delivery).toMatchObject({
      artifactId: '00000000-0000-4000-8000-000000000301',
      lifecycle: 'approved',
      downloadUrl:
        `/api/artifacts/00000000-0000-4000-8000-000000000301?projectId=${PROJECT_ID}`,
    })
  })

  it('blocks a terminal attempt when the artifact is still draft', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      attempt: attempt('succeeded'),
      nodes: websiteNodes('succeeded', passedExecution()),
      artifact: artifact('draft'),
    }))

    expect(snapshot.state).toBe('blocked')
    expect(snapshot.attempt?.failureCode).toBe('WEBSITE_STATE_INCONSISTENT')
    expect(snapshot.delivery?.downloadUrl).toBeUndefined()
  })

  it('reports an expired running lease as recovering', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      attempt: {
        ...attempt('running'),
        leaseExpiresAt: '2026-07-30T00:00:00.000Z',
      },
      now: '2026-07-30T00:00:01.000Z',
    }))

    expect(snapshot.state).toBe('recovering')
    expect(snapshot.active).toBe(true)
    expect(snapshot.canStop).toBe(true)
  })

  it('maps verification failure to blocked without exposing raw failure text', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      attempt: {
        ...attempt('failed'),
        failure: {
          schemaVersion: 2,
          failureCode: 'WEBSITE_VERIFICATION_FAILED',
          message: 'provider raw response must not escape',
        },
      },
      nodes: websiteNodes('failed', {
        ...passedExecution(),
        state: 'blocked',
        failure: { code: 'WEBSITE_VERIFICATION_FAILED' },
      }),
      artifact: artifact('rejected'),
    }))

    expect(snapshot.state).toBe('blocked')
    expect(snapshot.attempt?.failureCode).toBe('WEBSITE_VERIFICATION_FAILED')
    expect(JSON.stringify(snapshot)).not.toContain('provider raw response')
    expect(snapshot.delivery?.downloadUrl).toBeUndefined()
  })
})

function facts(
  overrides: Partial<ProjectExecutionFacts> = {},
): ProjectExecutionFacts {
  return {
    project: {
      id: PROJECT_ID,
      workflowKind: 'website',
      autopilot: false,
    },
    attempt: null,
    nodes: websiteNodes('idle'),
    artifact: null,
    now: '2026-07-30T00:01:00.000Z',
    ...overrides,
  }
}

function attempt(status: 'running' | 'succeeded' | 'failed') {
  return {
    id: ATTEMPT_ID,
    status,
    leaseExpiresAt: null,
    cancelRequestedAt: null,
    updatedAt: '2026-07-30T00:00:30.000Z',
    failure: null,
  }
}

function websiteNodes(
  status: string,
  exportExecution?: Record<string, unknown>,
) {
  const phases = [
    'capture',
    'script',
    'narration',
    'compose',
    'render',
    'export',
  ] as const
  return phases.map((phase, index) => ({
    id: `00000000-0000-4000-8000-0000000004${index.toString().padStart(2, '0')}`,
    logicalKey: `website:${phase}`,
    status,
    updatedAt: '2026-07-30T00:00:30.000Z',
    data: {
      schemaVersion: 1,
      payload: {
        phase,
        ...(phase === 'export' && exportExecution
          ? { websiteExecution: exportExecution }
          : {}),
      },
    },
  }))
}

function passedExecution() {
  return {
    schemaVersion: 1,
    phase: 'export',
    state: 'succeeded',
    updatedAt: '2026-07-30T00:00:30.000Z',
    verification: {
      checkPassed: true,
      goldenVerified: true,
      goldenCheckCount: 16,
      outcome: 'passed',
    },
    artifact: {
      artifactId: '00000000-0000-4000-8000-000000000301',
      contentHash: 'a'.repeat(64),
      sizeBytes: 2048,
    },
  }
}

function artifact(lifecycle: 'draft' | 'approved' | 'rejected') {
  return {
    id: '00000000-0000-4000-8000-000000000301',
    attemptId: ATTEMPT_ID,
    lifecycle,
    contentHash: 'a'.repeat(64),
    sizeBytes: 2048,
    version: 1,
  }
}
