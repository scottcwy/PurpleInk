import { describe, expect, it, vi } from 'vitest'
import {
  deriveProjectExecutionSnapshot,
  type ProjectExecutionFacts,
} from './project-execution-snapshot'

vi.mock('server-only', () => ({}))

const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'

describe('deriveProjectExecutionSnapshot', () => {
  it.each(['script', 'audio'] as const)(
    'reports %s latch-without-attempt as recovering instead of running',
    (workflowKind) => {
      const snapshot = deriveProjectExecutionSnapshot(facts({
        project: {
          id: PROJECT_ID,
          workflowKind,
          autopilot: workflowKind === 'script',
          directorContinuationEnabled: workflowKind === 'audio',
          soundEffects: 'off',
          subtitles: 'burn-in',
        },
        attempt: null,
        nodes: [node('entry', 'queued')],
      }))

      expect(snapshot.state).toBe('recovering')
      expect(snapshot.attempt).toBeNull()
      expect(snapshot.active).toBe(true)
    },
  )

  it.each(['script', 'audio'] as const)(
    'keeps an unfinished %s DAG recoverable after the latest node attempt succeeded',
    (workflowKind) => {
      const snapshot = deriveProjectExecutionSnapshot(facts({
        project: {
          id: PROJECT_ID,
          workflowKind,
          autopilot: true,
          directorContinuationEnabled: workflowKind === 'audio',
          soundEffects: 'off',
          subtitles: 'burn-in',
        },
        attempt: attempt('succeeded'),
        nodes: [
          node('entry', 'succeeded'),
          node('next', 'idle'),
        ],
      }))

      expect(snapshot.state).toBe('recovering')
      expect(snapshot.active).toBe(true)
      expect(snapshot.canStop).toBe(true)
    },
  )

  it.each(['script', 'audio'] as const)(
    'reports a %s DAG succeeded only when every node reached an accepted terminal state',
    (workflowKind) => {
      const snapshot = deriveProjectExecutionSnapshot(facts({
        project: {
          id: PROJECT_ID,
          workflowKind,
          autopilot: true,
          directorContinuationEnabled: workflowKind === 'audio',
          soundEffects: 'off',
          subtitles: 'burn-in',
        },
        attempt: attempt('succeeded'),
        nodes: [
          node('entry', 'succeeded'),
          node('optional', 'skipped'),
        ],
      }))

      expect(snapshot.state).toBe('succeeded')
      expect(snapshot.active).toBe(false)
    },
  )

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

  it('does not reuse an off delivery after the project requests procedural sound effects', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      project: {
        id: PROJECT_ID,
        workflowKind: 'website',
        autopilot: false,
        directorContinuationEnabled: false,
        soundEffects: 'procedural',
        subtitles: 'burn-in',
      },
      attempt: attempt('succeeded'),
      nodes: websiteNodes('succeeded', passedExecution()),
      artifact: artifact('approved'),
    }))

    expect(snapshot.state).toBe('blocked')
    expect(snapshot.canStart).toBe(true)
    expect(snapshot.delivery?.soundEffects?.mode).toBe('off')
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

  it('does not recover an unfinished audio DAG when its continuation latch is off', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      project: {
        id: PROJECT_ID,
        workflowKind: 'audio',
        autopilot: false,
        directorContinuationEnabled: false,
        soundEffects: 'off',
        subtitles: 'burn-in',
      },
      attempt: attempt('succeeded'),
      nodes: [node('entry', 'succeeded'), node('next', 'idle')],
    }))

    expect(snapshot.state).toBe('idle')
    expect(snapshot.active).toBe(false)
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

  it('publishes script Director, fan-out, merge, and export in snapshot v2', () => {
    const snapshot = deriveProjectExecutionSnapshot(facts({
      project: {
        id: PROJECT_ID,
        workflowKind: 'script',
        autopilot: true,
        directorContinuationEnabled: false,
        soundEffects: 'off',
        subtitles: 'burn-in',
      },
      attempt: attempt('running'),
      nodes: [
        node('global:script-import', 'succeeded'),
        node('global:shot-split', 'succeeded'),
        node('shot:S001:shot-script', 'running'),
        node('shot:S001:shot-codegen', 'idle'),
        node('global:score', 'idle'),
        node('global:export', 'idle'),
      ],
    }))

    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      projectKind: 'script',
      currentWork: { logicalKey: 'shot:S001:shot-script', state: 'running' },
      recovery: { canStart: false, canStop: true, mode: 'stop' },
      detail: {
        kind: 'script',
        fanOut: { shotCount: 1, completedShotCount: 0 },
        merge: { logicalKey: 'global:score' },
        export: { logicalKey: 'global:export' },
      },
    })
  })

  it('publishes audio ASR and original-audio binding without exposing node payload', () => {
    const asr = node('source:audio-transcribe', 'succeeded')
    asr.data = {
      schemaVersion: 1,
      payload: {
        audioTranscription: {
          status: 'ready',
          audioArtifactId: '00000000-0000-4000-8000-000000000777',
          providerRaw: 'must stay private',
        },
      },
    }
    const snapshot = deriveProjectExecutionSnapshot(facts({
      project: {
        id: PROJECT_ID,
        workflowKind: 'audio',
        autopilot: false,
        directorContinuationEnabled: true,
        soundEffects: 'off',
        subtitles: 'off',
      },
      attempt: attempt('succeeded'),
      nodes: [asr, node('global:shot-split', 'succeeded')],
    }))

    expect(snapshot.detail).toMatchObject({
      kind: 'audio',
      sourceAudioBound: true,
      asr: { logicalKey: 'source:audio-transcribe', state: 'succeeded' },
    })
    expect(JSON.stringify(snapshot)).not.toContain('providerRaw')
  })

  it('publishes script delivery only when the final schema matches subtitle settings', () => {
    const base = facts({
      project: {
        id: PROJECT_ID,
        workflowKind: 'script',
        autopilot: false,
        directorContinuationEnabled: false,
        soundEffects: 'off',
        subtitles: 'burn-in',
      },
      attempt: attempt('succeeded'),
      nodes: [node('global:export', 'succeeded')],
      artifact: { ...artifact('approved'), schemaVersion: 'cvc.final-video/v2' },
    })
    const matching = deriveProjectExecutionSnapshot(base)
    const stale = deriveProjectExecutionSnapshot({
      ...base,
      artifact: { ...base.artifact!, schemaVersion: 'cvc.final-video/v3' },
    })

    expect(matching.delivery?.downloadUrl).toContain('/api/artifacts/')
    expect(stale.delivery?.downloadUrl).toBeUndefined()
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
      directorContinuationEnabled: false,
      soundEffects: 'off',
      subtitles: 'burn-in',
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

function node(id: string, status: string) {
  return {
    id,
    logicalKey: id,
    status,
    updatedAt: '2026-07-30T00:00:30.000Z',
    data: { schemaVersion: 1, payload: {} },
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
    schemaVersion: 'cvc.website-video/v1',
    contentHash: 'a'.repeat(64),
    sizeBytes: 2048,
    version: 1,
    soundEffects: {
      artifactId: '00000000-0000-4000-8000-000000000302',
      lifecycle,
      mode: 'off' as const,
      status: 'omitted-off' as const,
      generatorVersion: 'procedural-sfx/1.0.0' as const,
      cueCount: 0,
      timingHash: null,
      cuePlanHash: null,
      waveformHashes: [],
    },
  }
}
