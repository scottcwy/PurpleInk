import { describe, expect, it, vi } from 'vitest'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  WorkerGatewayError,
  executeWorkerAiRequest,
  type WorkerGatewayDependencies,
} from './worker-gateway'
import type { WorkerAiRequest } from './worker-gateway-contract'

vi.mock('server-only', () => ({}))

const request = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  attemptId: '00000000-0000-4000-8000-000000000002',
  operationId: 'website:job:compose:1',
  operationIndex: 1,
  capability: 'text',
  workload: 'website-compose',
  content: [{ type: 'text', text: 'compose' }],
  maxOutputTokens: 100,
} satisfies WorkerAiRequest

describe('executeWorkerAiRequest', () => {
  it('rejects inactive attempts before any model call', async () => {
    const dependencies = deps({ isAttemptActive: vi.fn(async () => false) })
    await expect(executeWorkerAiRequest(request, dependencies))
      .rejects.toEqual(new WorkerGatewayError('ATTEMPT_NOT_ACTIVE'))
    expect(dependencies.hasOperation).not.toHaveBeenCalled()
    expect(dependencies.generateText).not.toHaveBeenCalled()
  })

  it('rejects a replayed operation before any outbound call', async () => {
    const dependencies = deps({ hasOperation: vi.fn(async () => true) })
    await expect(executeWorkerAiRequest(request, dependencies))
      .rejects.toEqual(new WorkerGatewayError('OPERATION_REPLAYED'))
    expect(dependencies.generateText).not.toHaveBeenCalled()
  })

  it('executes inside the requested workspace context', async () => {
    const generateText = vi.fn(async () => {
      expect(currentWorkspaceId()).toBe(request.workspaceId)
      return 'done'
    })
    await expect(executeWorkerAiRequest(request, deps({ generateText })))
      .resolves.toEqual({ ok: true, capability: 'text', text: 'done' })
  })

  it('returns only encoded audio metadata for TTS', async () => {
    const ttsRequest = {
      workspaceId: request.workspaceId,
      attemptId: request.attemptId,
      operationId: 'website:job:tts:1',
      operationIndex: 1,
      capability: 'tts',
      workload: 'website-tts',
      text: '旁白',
    } satisfies WorkerAiRequest
    const result = await executeWorkerAiRequest(ttsRequest, deps())
    expect(result).toEqual({
      ok: true,
      capability: 'tts',
      audioBase64: Buffer.from('RIFF').toString('base64'),
      audioFormat: 'wav',
      durationMs: 1_000,
    })
  })
})

function deps(
  overrides: Partial<WorkerGatewayDependencies> = {},
): WorkerGatewayDependencies {
  return {
    isAttemptActive: vi.fn(async () => true),
    hasOperation: vi.fn(async () => false),
    generateText: vi.fn(async () => 'done'),
    synthesizeSpeech: vi.fn(async () => ({
      audioBytes: Buffer.from('RIFF'),
      audioFormat: 'wav' as const,
      durationMs: 1_000,
    })),
    ...overrides,
  }
}
