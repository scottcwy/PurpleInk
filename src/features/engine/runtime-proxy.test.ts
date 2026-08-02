import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const proxyModulePath = resolve(
  process.cwd(),
  'src/features/engine/runtime-proxy.ts'
)

describe('runtime engine proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('moves /api/engine forwarding out of the build-time Next rewrite', async () => {
    expect(existsSync(proxyModulePath)).toBe(true)
    if (!existsSync(proxyModulePath)) return

    const nextConfig = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8')
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/engine/[[...path]]/route.ts'),
      'utf8'
    )
    expect(nextConfig).not.toContain('async rewrites()')
    expect(route).toContain("@/features/engine/runtime-proxy")
  })

  it('reads BACKEND_ORIGIN per request and preserves query, Range, and response status', async () => {
    expect(existsSync(proxyModulePath)).toBe(true)
    if (!existsSync(proxyModulePath)) return
    const { proxyEngineRequest } = await import('./runtime-proxy')
    vi.stubEnv('BACKEND_ORIGIN', 'http://worker.zeabur.internal:8080')
    const upstreamFetch = vi.fn(async () => new Response('video', {
      status: 206,
      headers: {
        'content-range': 'bytes 0-4/5',
        'content-type': 'video/mp4',
      },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await proxyEngineRequest(
      new Request('https://purpleink.dev/api/engine/jobs/job-1/video?download=1', {
        headers: { range: 'bytes=0-4' },
      }),
      ['jobs', 'job-1', 'video']
    )

    const [url, init] = upstreamFetch.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ]
    expect(String(url)).toBe(
      'http://worker.zeabur.internal:8080/jobs/job-1/video?download=1'
    )
    expect(new Headers(init?.headers).get('range')).toBe('bytes=0-4')
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-4/5')
  })

  it('forwards request bodies and sanitizes unreachable-worker failures', async () => {
    expect(existsSync(proxyModulePath)).toBe(true)
    if (!existsSync(proxyModulePath)) return
    const { proxyEngineRequest } = await import('./runtime-proxy')
    vi.stubEnv('BACKEND_ORIGIN', 'http://worker.zeabur.internal:8080')
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"jobId":"job-1"}', { status: 202 }))
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND private-worker'))
    vi.stubGlobal('fetch', upstreamFetch)

    const accepted = await proxyEngineRequest(
      new Request('https://purpleink.dev/api/engine/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"url":"https://example.com"}',
      }),
      ['render']
    )
    expect(accepted.status).toBe(202)
    const requestInit = (upstreamFetch.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ])[1]
    expect(new TextDecoder().decode(requestInit?.body as ArrayBuffer)).toBe(
      '{"url":"https://example.com"}'
    )

    const failed = await proxyEngineRequest(
      new Request('https://purpleink.dev/api/engine/health'),
      ['health']
    )
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({
      ok: false,
      error: '渲染服务暂时不可用',
    })
  })
})
