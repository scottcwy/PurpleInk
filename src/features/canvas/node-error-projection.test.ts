import { describe, expect, it } from 'vitest'
import { parseWorkflowBlock } from './node-error-projection'

describe('parseWorkflowBlock', () => {
  it('projects the complete degraded-export confirmation block', () => {
    const block = {
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
      message: '请确认降级交付。',
      recovery: 'confirm_degraded_export',
      referenceId: 'ref-1',
      blockedAt: '2026-07-29T06:25:05.000Z',
      confirmationFingerprint: 'sha256:input',
    }

    expect(parseWorkflowBlock(block)).toEqual(block)
  })

  it('rejects incomplete or unrelated payloads', () => {
    expect(parseWorkflowBlock({ code: 'STAGE_FAILED' })).toBeUndefined()
    expect(parseWorkflowBlock({
      code: 'DEGRADED_EXPORT_CONFIRMATION_REQUIRED',
      recovery: 'confirm_degraded_export',
    })).toBeUndefined()
  })
})
