import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WebsiteEngineClient,
  WebsiteEngineError,
  type WebsiteEngineJob,
} from './engine-client'

vi.mock('server-only', () => ({}))

const JOB: WebsiteEngineJob = {
  id: 'job-1',
  requestId: 'website:project-1:attempt-1',
  origin: 'https://example.com',
  status: 'running',
  phase: 'capturing',
  durationSec: 24,
  durationSource: 'request',
  elapsedSec: null,
  checkPassed: null,
  goldenVerified: null,
  goldenCheckCount: 0,
  hasVideo: false,
  videoUrl: null,
  failure: null,
}

describe('WebsiteEngineClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts an integrated render without leaking the internal key into the body', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ reused: false, job: JOB }, { status: 202 }),
    )
    const client = new WebsiteEngineClient({
      origin: 'http://worker:8787/',
      internalKey: 'server-secret',
      fetcher,
    })

    await expect(
      client.start({
        requestId: JOB.requestId,
        url: 'https://example.com/product?campaign=private',
        name: '产品介绍',
        durationSec: 24,
        quality: 'standard',
      }),
    ).resolves.toEqual({ reused: false, job: JOB })

    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toBe('http://worker:8787/internal/render')
    expect(init?.headers).toEqual({
      authorization: 'Bearer server-secret',
      'content-type': 'application/json',
    })
    expect(String(init?.body)).not.toContain('server-secret')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requestId: JOB.requestId,
      url: 'https://example.com/product?campaign=private',
      duration: 24,
      quality: 'standard',
      generation: 'auto',
    })
  })

  it('reads only the safe integrated job contract', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) =>
      Response.json({
        ...JOB,
        rawError: 'must not be accepted',
        logs: ['secret'],
        videoPath: 'C:\\secret\\video.mp4',
      }),
    )
    const client = new WebsiteEngineClient({
      origin: 'http://worker:8787',
      internalKey: 'server-secret',
      fetcher,
    })

    await expect(client.getJob('job-1')).resolves.toEqual(JOB)
  })

  it('downloads non-empty MP4 bytes through the protected endpoint', async () => {
    const bytes = Buffer.from('real-mp4-bytes')
    const fetcher = vi.fn(async (_url: string | URL | Request) =>
      new Response(bytes, {
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(bytes.byteLength),
        },
      }),
    )
    const client = new WebsiteEngineClient({
      origin: 'http://worker:8787',
      internalKey: 'server-secret',
      fetcher,
    })

    await expect(client.downloadVideo('job/1')).resolves.toEqual(bytes)
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'http://worker:8787/internal/jobs/job%2F1/video',
    )
  })

  it('classifies missing jobs as a retryable restart boundary', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: 'job not found' }, { status: 404 }),
    )
    const client = new WebsiteEngineClient({
      origin: 'http://worker:8787',
      internalKey: 'server-secret',
      fetcher,
    })

    await expect(client.getJob('lost-job')).rejects.toMatchObject({
      name: 'WebsiteEngineError',
      code: 'ENGINE_JOB_NOT_FOUND',
      retryable: true,
      status: 404,
    })
  })

  it('fails closed before fetch when the internal service key is absent', () => {
    expect(
      () =>
        new WebsiteEngineClient({
          origin: 'http://worker:8787',
          internalKey: '',
          fetcher: vi.fn(),
        }),
    ).toThrowError(WebsiteEngineError)
  })
})
