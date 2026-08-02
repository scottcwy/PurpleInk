import { proxyEngineRequest } from '@/features/engine/runtime-proxy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EngineRouteContext {
  params: Promise<{ path?: string[] }>
}

async function handle(
  request: Request,
  { params }: EngineRouteContext
): Promise<Response> {
  return proxyEngineRequest(request, (await params).path ?? [])
}

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as OPTIONS,
  handle as PATCH,
  handle as POST,
  handle as PUT,
}
