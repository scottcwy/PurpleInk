import { describe, expect, it, vi } from 'vitest'
import type { QueueAdapter } from '@/lib/queue'
import {
  enqueueMediaNarration,
  registerMediaNarrationHandler,
  runMediaNarrationJob,
  type MediaNarrationDependencies,
} from './narration-queue-handler'

vi.mock('server-only', () => ({}))

function dependencies(): MediaNarrationDependencies {
  return {
    loadScriptUnits: vi.fn(async () => [{ unitId: 'U001', text: '第一句', order: 0 }]),
    synthesize: vi.fn(async () => ({
      engine: 'mimo-v2.5-tts',
      voice: 'mimo_default',
      units: [
        {
          unitId: 'U001',
          text: '第一句',
          audioKey: 'narration/p/hash.wav',
          audioArtifactId: 'audio-1',
          contentHash: 'a'.repeat(64),
          durationMs: 1_000,
          sampleRateHz: 24_000,
          sampleCount: 24_000,
          nativeCaptions: [],
          reused: false,
        },
      ],
    })),
    persistResult: vi.fn(async () => 'media-artifact-1'),
    updateMediaState: vi.fn(async () => {}),
    listWakeNodeIds: vi.fn(async () => ['shot-script-1']),
    advance: vi.fn(async () => {}),
  }
}

describe('media narration queue', () => {
  it('persists real timing separately and wakes the text frontier', async () => {
    const deps = dependencies()

    await runMediaNarrationJob(
      { projectId: 'project-1', nodeId: 'ingest-1' },
      deps
    )

    expect(deps.persistResult).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        nodeId: 'ingest-1',
        audioManifest: expect.objectContaining({ engine: 'mimo-v2.5-tts' }),
        audioAllocation: expect.objectContaining({
          shots: [expect.objectContaining({ id: 'S001', durationInFrames: 30 })],
        }),
      })
    )
    expect(deps.updateMediaState).toHaveBeenCalledWith(
      'ingest-1',
      expect.objectContaining({ status: 'ready', artifactId: 'media-artifact-1' })
    )
    expect(deps.advance).toHaveBeenCalledWith('project-1', 'shot-script-1')
  })

  it('projects a safe media failure without changing the INGEST node status', async () => {
    const deps = dependencies()
    vi.mocked(deps.synthesize).mockRejectedValueOnce(new Error('MiMo TTS HTTP 503 raw body'))

    await expect(
      runMediaNarrationJob({ projectId: 'project-1', nodeId: 'ingest-1' }, deps)
    ).rejects.toThrow('MiMo TTS HTTP 503')

    expect(deps.persistResult).not.toHaveBeenCalled()
    expect(deps.updateMediaState).toHaveBeenCalledWith(
      'ingest-1',
      expect.objectContaining({
        status: 'failed',
        error: {
          code: 'PROVIDER_FAILED',
          stage: 'MEDIA_NARRATION',
          message: '外部生成服务本次执行失败，可以稍后重试。',
          retryable: true,
          sourceNodeId: 'ingest-1',
        },
      })
    )
    expect(deps.advance).not.toHaveBeenCalled()
  })

  it('registers and enqueues a dedicated queue kind on the INGEST aggregate', async () => {
    let handler: Parameters<QueueAdapter['register']>[1] | undefined
    const queue = {
      register: vi.fn((kind, registered) => {
        expect(kind).toBe('media-narration')
        handler = registered
      }),
      enqueue: vi.fn(async () => 'job-1'),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as QueueAdapter
    const run = vi.fn(async () => {})
    registerMediaNarrationHandler(queue, run)

    await enqueueMediaNarration(
      { projectId: 'project-1', nodeId: 'ingest-1' },
      queue,
      vi.fn(async () => {}),
    )
    expect(queue.enqueue).toHaveBeenCalledWith(
      'media-narration',
      { projectId: 'project-1', nodeId: 'ingest-1' },
      { projectId: 'project-1', nodeId: 'ingest-1' }
    )
    expect(handler).toBeDefined()
    await handler?.({
      id: 'attempt-1',
      workspaceId: 'workspace-1',
      kind: 'media-narration',
      status: 'running',
      payload: { projectId: 'project-1', nodeId: 'ingest-1' },
      attempts: 1,
    })
    expect(run).toHaveBeenCalledWith({
      projectId: 'project-1',
      nodeId: 'ingest-1',
      billingContext: { attemptId: 'attempt-1', invocationNo: 10_000 },
    })
  })

  it('does not enqueue narration when the quick billing preflight fails', async () => {
    const queue = {
      enqueue: vi.fn(async () => 'job-1'),
    } as unknown as QueueAdapter

    await expect(enqueueMediaNarration(
      { projectId: 'project-1', nodeId: 'ingest-1' },
      queue,
      vi.fn(async () => {
        throw new Error('quota_exhausted')
      }),
    )).rejects.toThrow('quota_exhausted')

    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})
