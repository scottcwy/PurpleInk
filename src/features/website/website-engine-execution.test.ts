import { describe, expect, it, vi } from 'vitest'
import {
  WebsiteEngineError,
  type WebsiteEngineJob,
} from './engine-client'
import {
  createWebsiteEngineRequestId,
  executeWebsiteEngine,
  WEBSITE_EXECUTION_TIMEOUT_MS,
} from './website-engine-execution'

vi.mock('server-only', () => ({}))

const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'

function job(overrides: Partial<WebsiteEngineJob> = {}): WebsiteEngineJob {
  return {
    id: 'engine-job-1',
    requestId: createWebsiteEngineRequestId(PROJECT_ID, ATTEMPT_ID),
    origin: 'https://example.com/product?private=campaign',
    status: 'running',
    phase: 'capturing',
    durationSec: 30,
    durationSource: 'request',
    elapsedSec: 1,
    checkPassed: null,
    goldenVerified: null,
    goldenCheckCount: 0,
    soundEffects: null,
    hasVideo: false,
    videoUrl: null,
    failure: null,
    ...overrides,
  }
}

describe('executeWebsiteEngine', () => {
  it('re-submits a missing in-memory job once with the exact same requestId', async () => {
    const start = vi
      .fn()
      .mockResolvedValueOnce({ reused: false, job: job({ status: 'queued', phase: 'queued' }) })
      .mockResolvedValueOnce({
        reused: false,
        job: job({ id: 'engine-job-2', phase: 'rendering' }),
      })
    const getJob = vi
      .fn()
      .mockRejectedValueOnce(
        new WebsiteEngineError('ENGINE_JOB_NOT_FOUND', true, 404),
      )
      .mockResolvedValueOnce(job({
        id: 'engine-job-2',
        status: 'done',
        phase: 'done',
        durationSec: 28.5,
        durationSource: 'output',
        elapsedSec: 28.5,
        checkPassed: true,
        goldenVerified: true,
        goldenCheckCount: 2,
        hasVideo: true,
        videoUrl: '/internal/video',
        soundEffects: completedSoundEffects(),
      }))
    const progress = vi.fn(async () => undefined)

    const result = await executeWebsiteEngine(input(), dependencies({
      engine: {
        start,
        getJob,
        downloadVideo: vi.fn(async () => Buffer.from('video')),
      },
      onProgress: progress,
    }))

    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[0]?.[0].requestId).toBe(start.mock.calls[1]?.[0].requestId)
    expect(result.job.durationSource).toBe('output')
    expect(JSON.stringify(progress.mock.calls)).not.toContain('private=campaign')
    expect(JSON.stringify(progress.mock.calls)).not.toContain('/internal/video')
  })

  it('does not re-submit more than once after consecutive worker 404 responses', async () => {
    const start = vi.fn(async () => ({ reused: false, job: job() }))
    const missing = new WebsiteEngineError('ENGINE_JOB_NOT_FOUND', true, 404)
    const getJob = vi.fn().mockRejectedValue(missing)

    await expect(executeWebsiteEngine(input(), dependencies({
      engine: {
        start,
        getJob,
        downloadVideo: vi.fn(),
      },
    }))).rejects.toBe(missing)
    expect(start).toHaveBeenCalledTimes(2)
    expect(getJob).toHaveBeenCalledTimes(2)
  })

  it('keeps polling the same job after a transient worker outage', async () => {
    const unavailable = new WebsiteEngineError(
      'ENGINE_UNAVAILABLE',
      true,
      503,
    )
    const getJob = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(job({
        status: 'done',
        phase: 'done',
        durationSec: 5,
        durationSource: 'output',
        elapsedSec: 40,
        checkPassed: false,
        goldenVerified: false,
        goldenCheckCount: 15,
        hasVideo: true,
        videoUrl: '/internal/video',
        soundEffects: completedSoundEffects(),
      }))
    const start = vi.fn(async () => ({ reused: false, job: job() }))

    const result = await executeWebsiteEngine(input(), dependencies({
      engine: {
        start,
        getJob,
        downloadVideo: vi.fn(async () => Buffer.from('video')),
      },
    }))

    expect(result.videoBytes).toEqual(Buffer.from('video'))
    expect(start).toHaveBeenCalledOnce()
    expect(getJob).toHaveBeenCalledTimes(2)
  })

  it('retries a transient video download without starting another render', async () => {
    const unavailable = new WebsiteEngineError(
      'ENGINE_UNAVAILABLE',
      true,
      503,
    )
    const start = vi.fn(async () => ({
      reused: false,
      job: job({
        status: 'done',
        phase: 'done',
        durationSec: 5,
        durationSource: 'output',
        elapsedSec: 40,
        checkPassed: false,
        goldenVerified: false,
        goldenCheckCount: 15,
        hasVideo: true,
        videoUrl: '/internal/video',
        soundEffects: completedSoundEffects(),
      }),
    }))
    const downloadVideo = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(Buffer.from('video'))

    const result = await executeWebsiteEngine(input(), dependencies({
      engine: {
        start,
        getJob: vi.fn(),
        downloadVideo,
      },
    }))

    expect(result.videoBytes).toEqual(Buffer.from('video'))
    expect(start).toHaveBeenCalledOnce()
    expect(downloadVideo).toHaveBeenCalledTimes(2)
  })

  it('stops at the 45 minute boundary without issuing another poll', async () => {
    let now = 0
    const getJob = vi.fn(async () => job())

    await expect(executeWebsiteEngine(input(), dependencies({
      engine: {
        start: vi.fn(async () => ({ reused: false, job: job() })),
        getJob,
        downloadVideo: vi.fn(),
      },
      nowMs: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds
      },
      pollIntervalMs: 30 * 60 * 1_000,
      timeoutMs: WEBSITE_EXECUTION_TIMEOUT_MS + 60_000,
    }))).rejects.toMatchObject({ code: 'WEBSITE_ENGINE_TIMEOUT' })
    expect(now).toBe(WEBSITE_EXECUTION_TIMEOUT_MS)
    expect(getJob).toHaveBeenCalledOnce()
  })

  it('bounds a hanging initial start by the workflow deadline', async () => {
    vi.useFakeTimers()
    try {
      const execution = executeWebsiteEngine(input(), dependencies({
        engine: {
          start: vi.fn(() => new Promise<never>(() => undefined)),
          getJob: vi.fn(),
          downloadVideo: vi.fn(),
        },
        timeoutMs: 25,
      }))
      const rejection = expect(execution).rejects.toMatchObject({
        code: 'WEBSITE_ENGINE_TIMEOUT',
      })

      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a hanging video download by the same workflow deadline', async () => {
    vi.useFakeTimers()
    try {
      const execution = executeWebsiteEngine(input(), dependencies({
        engine: {
          start: vi.fn(async () => ({
            reused: false,
            job: job({
              status: 'done',
              phase: 'done',
              hasVideo: true,
              durationSource: 'output',
              checkPassed: true,
              goldenVerified: true,
              soundEffects: completedSoundEffects(),
            }),
          })),
          getJob: vi.fn(),
          downloadVideo: vi.fn(() => new Promise<never>(() => undefined)),
        },
        timeoutMs: 25,
      }))
      const rejection = expect(execution).rejects.toMatchObject({
        code: 'WEBSITE_ENGINE_TIMEOUT',
      })

      await vi.advanceTimersByTimeAsync(25)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the worker job when the project AbortSignal fires', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => undefined)

    await expect(executeWebsiteEngine(input(), dependencies({
      engine: {
        start: vi.fn(async () => ({ reused: false, job: job() })),
        getJob: vi.fn(async () => job()),
        downloadVideo: vi.fn(),
        cancel,
      },
      signal: controller.signal,
      sleep: async () => {
        controller.abort(new Error('PROJECT_EXECUTION_CANCELLED'))
      },
    }))).rejects.toThrow('PROJECT_EXECUTION_CANCELLED')
    expect(cancel).toHaveBeenCalledWith('engine-job-1')
  })
})

function input() {
  return {
    projectId: PROJECT_ID,
    attemptId: ATTEMPT_ID,
    url: 'https://example.com/product?private=campaign',
    name: '网站介绍',
    durationSec: 30,
    quality: 'standard' as const,
    soundEffects: 'procedural' as const,
  }
}

function completedSoundEffects(): NonNullable<WebsiteEngineJob['soundEffects']> {
  return {
    mode: 'procedural',
    status: 'applied',
    generatorVersion: 'procedural-sfx/1.0.0',
    cueCount: 2,
    timingHash: 'a'.repeat(64),
    cuePlanHash: 'b'.repeat(64),
    waveformHashes: ['c'.repeat(64), 'd'.repeat(64)],
  }
}

function dependencies(
  overrides: Partial<Parameters<typeof executeWebsiteEngine>[1]> = {},
): Parameters<typeof executeWebsiteEngine>[1] {
  return {
    engine: {
      start: vi.fn(async () => ({ reused: false, job: job() })),
      getJob: vi.fn(async () => job()),
      downloadVideo: vi.fn(async () => Buffer.from('video')),
    },
    onProgress: vi.fn(async () => undefined),
    nowMs: () => 0,
    sleep: vi.fn(async () => undefined),
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    ...overrides,
  }
}
