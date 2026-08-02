const DEFAULT_BACKEND_ORIGIN = 'http://localhost:8787'

const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

/** Runtime-only proxy boundary for the private render worker. */
export async function proxyEngineRequest(
  request: Request,
  path: readonly string[]
): Promise<Response> {
  try {
    const target = workerUrl(request.url, path)
    const headers = forwardedHeaders(request.headers)
    const body = BODYLESS_METHODS.has(request.method)
      ? undefined
      : await request.arrayBuffer()
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: request.signal,
    })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers),
    })
  } catch (error) {
    console.error('[engine-proxy] worker request failed', {
      cause: error instanceof Error ? error.name : 'unknown',
    })
    return Response.json(
      { ok: false, error: '渲染服务暂时不可用' },
      { status: 502 }
    )
  }
}

function workerUrl(requestUrl: string, path: readonly string[]): URL {
  const origin = new URL(
    process.env.BACKEND_ORIGIN?.trim() || DEFAULT_BACKEND_ORIGIN
  )
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error('BACKEND_ORIGIN must use http or https')
  }
  const target = new URL(origin)
  const basePath = target.pathname.replace(/\/$/, '')
  const forwardedPath = path.map((segment) => encodeURIComponent(segment)).join('/')
  target.pathname = `${basePath}/${forwardedPath}` || '/'
  target.search = new URL(requestUrl).search
  return target
}

function forwardedHeaders(source: Headers): Headers {
  const headers = new Headers(source)
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name)
  return headers
}

function responseHeaders(source: Headers): Headers {
  const headers = new Headers(source)
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name)
  return headers
}
