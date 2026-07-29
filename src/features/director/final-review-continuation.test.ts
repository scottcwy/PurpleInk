import { describe, expect, it, vi } from 'vitest'
import { continueExportFinalReview } from './final-review-continuation'

vi.mock('server-only', () => ({}))

describe('continueExportFinalReview', () => {
  it('reuses an active or succeeded FINALIZE attempt for the same final hash', async () => {
    const enqueue = vi.fn(async () => 'new-attempt')
    const result = await continueExportFinalReview(
      {
        projectId: 'project-1',
        exportNodeId: 'export-node',
        mode: 'degraded',
        finalArtifactHash: 'a'.repeat(64),
        confirmationFingerprint: 'confirmation-v1',
      },
      {
        findExistingAttempt: vi.fn(async () => 'existing-attempt'),
        enqueue,
      }
    )

    expect(result).toBe('existing-attempt')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('queues FINALIZE with the final artifact hash as its idempotency input', async () => {
    const enqueue = vi.fn(async () => 'new-attempt')
    const result = await continueExportFinalReview(
      {
        projectId: 'project-1',
        exportNodeId: 'export-node',
        mode: 'complete',
        finalArtifactHash: 'b'.repeat(64),
      },
      {
        findExistingAttempt: vi.fn(async () => null),
        enqueue,
      }
    )

    expect(result).toBe('new-attempt')
    expect(enqueue).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'export-node',
      stage: 'FINALIZE',
      finalArtifactHash: 'b'.repeat(64),
    })
  })
})
