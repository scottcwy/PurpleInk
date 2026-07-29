import { describe, expect, it, vi } from 'vitest'
import type { QueueAdapter, QueueJob } from '@/lib/queue'
import {
  enqueueAudioTranscription,
  registerAudioTranscriptionHandler,
  runAudioTranscriptionQueueJob,
  type AudioTranscriptionEnqueueDependencies,
} from './audio-transcription-queue-handler'

vi.mock('server-only', () => ({}))

const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const NODE_ID = '20000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000001'
const PAYLOAD = { projectId: PROJECT_ID, nodeId: NODE_ID }

function dependencies(): AudioTranscriptionEnqueueDependencies {
  return {
    enqueueOnce: vi.fn(async (_payload, enqueue) => enqueue()),
    preflight: vi.fn(async () => undefined),
    captureFingerprint: vi.fn(async () => undefined),
    assertRetryBudget: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
    queue: {
      enqueue: vi.fn(async () => ATTEMPT_ID),
      register: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    },
  }
}

describe('audio transcription queue integration', () => {
  it('binds ASR billing to the real queue attempt and never accepts it from payload', async () => {
    const run = vi.fn(async () => undefined)
    await runAudioTranscriptionQueueJob(
      {
        id: ATTEMPT_ID,
        workspaceId: '40000000-0000-4000-8000-000000000001',
        kind: 'audio-transcription',
        status: 'running',
        payload: PAYLOAD,
        attempts: 1,
      },
      run,
    )

    expect(run).toHaveBeenCalledWith({
      ...PAYLOAD,
      billingContext: {
        attemptId: ATTEMPT_ID,
        invocationNo: 40_000,
      },
    })
  })

  it('runs preflight and node projection only when enqueueOnce creates a job', async () => {
    const deps = dependencies()
    await expect(enqueueAudioTranscription(PAYLOAD, deps)).resolves.toBe(ATTEMPT_ID)

    expect(deps.preflight).toHaveBeenCalledOnce()
    expect(deps.captureFingerprint).toHaveBeenCalledWith(NODE_ID)
    expect(deps.assertRetryBudget).toHaveBeenCalledWith(
      'audio-transcription',
      PAYLOAD,
    )
    expect(deps.transition).toHaveBeenCalledWith(NODE_ID, 'pending')
    expect(deps.queue.enqueue).toHaveBeenCalledWith(
      'audio-transcription',
      PAYLOAD,
      { projectId: PROJECT_ID, nodeId: NODE_ID },
    )
  })

  it('reuses an active attempt without repeating preflight or node transitions', async () => {
    const deps = dependencies()
    deps.enqueueOnce = vi.fn(async () => ATTEMPT_ID)

    await expect(enqueueAudioTranscription(PAYLOAD, deps)).resolves.toBe(ATTEMPT_ID)
    expect(deps.preflight).not.toHaveBeenCalled()
    expect(deps.transition).not.toHaveBeenCalled()
    expect(deps.queue.enqueue).not.toHaveBeenCalled()
  })

  it('registers exactly one handler for the audio job kind', async () => {
    let handler: ((job: QueueJob) => Promise<void>) | undefined
    const queue = {
      enqueue: vi.fn(),
      register: vi.fn((_kind, candidate) => {
        handler = candidate
      }),
      start: vi.fn(),
      stop: vi.fn(),
    } satisfies QueueAdapter
    const run = vi.fn(async () => undefined)
    registerAudioTranscriptionHandler(queue, run)

    expect(queue.register).toHaveBeenCalledWith(
      'audio-transcription',
      expect.any(Function),
    )
    await handler?.({
      id: ATTEMPT_ID,
      workspaceId: '40000000-0000-4000-8000-000000000001',
      kind: 'audio-transcription',
      status: 'running',
      payload: PAYLOAD,
      attempts: 1,
    })
    expect(run).toHaveBeenCalledOnce()
  })
})
