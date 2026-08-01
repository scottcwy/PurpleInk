import { describe, expect, it } from 'vitest'
import {
  classifyAttemptFailure,
  normalizeAiAuditRow,
  normalizeJobRow,
} from './operational-projections'

describe('admin operational projections', () => {
  it('maps workflow failures to a safe category without exposing provider text', () => {
    const failure = {
      version: 1,
      payload: {
        kind: 'provider_rate_limit',
        message: 'upstream rejected sk-secret and user@example.com',
        providerResponse: { body: 'private response' },
      },
    }

    expect(classifyAttemptFailure(failure)).toBe('capacity')
    expect(JSON.stringify(classifyAttemptFailure(failure))).not.toContain('secret')
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
        version: 1,
        payload: { kind: 'timeout', message: 'credential=private' },
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
      officialCostCnyMicros: '12500',
      entitlementDebitCnyMicros: '15000',
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
      officialCostCnyMicros: '12500',
      entitlementDebitCnyMicros: '15000',
      lastInvokedAt: '2026-08-01T00:03:00.000Z',
    })
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('prompt')
    expect(serialized).not.toContain('failureMessage')
  })
})
