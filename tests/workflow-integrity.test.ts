import { describe, expect, it } from 'vitest'
import { summarizeWorkflowIntegrity } from '../scripts/verify/workflow-integrity-result'

describe('summarizeWorkflowIntegrity', () => {
  it('fails the gate when a blocking workflow invariant has violations', () => {
    const summary = summarizeWorkflowIntegrity([
      { check: 'terminal_attempt_running_invocation', count: 2 },
      { check: 'historical_timestamp_inversion', count: 4, blocking: false },
    ], '2026-08-01T00:00:00.000Z')

    expect(summary).toMatchObject({
      ok: false,
      blockingViolations: 2,
      advisoryViolations: 4,
    })
    expect(summary.referenceId).toMatch(/^[0-9a-f]{12}$/)
  })

  it('keeps historical-only findings advisory', () => {
    expect(summarizeWorkflowIntegrity([
      { check: 'historical_timestamp_inversion', count: 25, blocking: false },
    ], '2026-08-01T00:00:00.000Z')).toMatchObject({
      ok: true,
      blockingViolations: 0,
      advisoryViolations: 25,
    })
  })
})
