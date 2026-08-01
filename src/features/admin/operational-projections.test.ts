import { describe, expect, it } from 'vitest'
import {
  classifyAttemptFailure,
  normalizeAiAuditRow,
  normalizeJobRow,
} from './operational-projections'

describe('admin operational projections', () => {
  it('maps PROVIDER_POOL_WAIT to capacity without exposing provider text', () => {
    const failure = {
      schemaVersion: 1,
      payload: {
        code: 'PROVIDER_POOL_WAIT',
        message: 'upstream rejected sk-secret and user@example.com',
        providerResponse: { body: 'private response' },
      },
    }

    expect(classifyAttemptFailure(failure)).toBe('capacity')
    expect(JSON.stringify(classifyAttemptFailure(failure))).not.toContain('secret')
  })

  it('maps TASK_INTERRUPTED to cancelled', () => {
    expect(classifyAttemptFailure({ schemaVersion: 2, code: 'TASK_INTERRUPTED' }))
      .toBe('cancelled')
  })

  it('maps unknown failure codes to internal without returning raw data', () => {
    const failure = {
      schemaVersion: 2,
      code: 'PROVIDER_POOL_WAIT_WITH_SECRET_SUFFIX',
      message: 'credential=private',
    }
    expect(classifyAttemptFailure(failure)).toBe('internal')
    expect(JSON.stringify(classifyAttemptFailure(failure))).not.toContain('private')
  })

  it('returns only the allowlisted run and attempt fields', () => {
    const projected = normalizeJobRow({
      runId: 'run-1',
      runStatus: 'failed',
      workflowVersion: 'v3',
      runCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      attemptId: 'attempt-1',
      taskId: 'DIRECT',
      entityType: 'canvas_node',
      attemptNo: 2,
      attemptStatus: 'failed',
      attemptCreatedAt: new Date('2026-08-01T00:01:00.000Z'),
      attemptCompletedAt: new Date('2026-08-01T00:02:00.000Z'),
      failure: {
        schemaVersion: 2,
        code: 'PROVIDER_TIMEOUT',
        message: 'credential=private',
      },
    })

    expect(projected).toEqual({
      runId: 'run-1',
      runStatus: 'failed',
      workflowVersion: 'v3',
      runCreatedAt: '2026-08-01T00:00:00.000Z',
      attemptId: 'attempt-1',
      taskId: 'DIRECT',
      entityType: 'canvas_node',
      attemptNo: 2,
      attemptStatus: 'failed',
      attemptCreatedAt: '2026-08-01T00:01:00.000Z',
      attemptCompletedAt: '2026-08-01T00:02:00.000Z',
      failureCategory: 'timeout',
    })
    expect(JSON.stringify(projected)).not.toContain('credential')
  })

  it('normalizes v3 AI audit aggregates without PII, prompts or raw errors', () => {
    const projected = normalizeAiAuditRow({
      logicalModelId: 'director-text',
      outboundModelId: 'model-2026',
      deploymentId: 'production-a',
      channelId: 'managed',
      funding: 'managed',
      failureDomainId: 'provider-a:text',
      status: 'succeeded',
      invocationCount: 3,
      officialCostCnyMicros: null,
      officialCostKnownCnyMicros: '12500',
      officialCostLedgerCount: 2,
      officialCostMeasurementQualities: 'reported,uncertain',
      entitlementDebitCnyMicros: null,
      entitlementKnownDebitCnyMicros: '15000',
      entitlementLedgerCount: 1,
      lastInvokedAt: new Date('2026-08-01T00:03:00.000Z'),
      prompt: 'must never appear',
      actorUserId: 'user-private',
      workspaceId: 'workspace-private',
      failureMessage: 'provider raw response',
    })

    expect(projected).toEqual({
      logicalModelId: 'director-text',
      outboundModelId: 'model-2026',
      deploymentId: 'production-a',
      channelId: 'managed',
      funding: 'managed',
      failureDomainId: 'provider-a:text',
      status: 'succeeded',
      invocationCount: 3,
      officialCost: {
        totalCnyMicros: null,
        knownCnyMicros: '12500',
        ledgerCount: 2,
        measurementQualities: ['reported', 'uncertain'],
      },
      entitlement: {
        totalDebitCnyMicros: null,
        knownDebitCnyMicros: '15000',
        ledgerCount: 1,
      },
      lastInvokedAt: '2026-08-01T00:03:00.000Z',
    })
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('prompt')
    expect(serialized).not.toContain('failureMessage')
  })
})
