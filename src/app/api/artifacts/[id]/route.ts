import { artifactContentType, readArtifact } from '@/features/artifacts'
import { withApiSession } from '@/features/auth/api-session'

export const dynamic = 'force-dynamic'

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withApiSession(() => handleGet(request, params))
}

async function handleGet(request: Request, params: Promise<{ id: string }>) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return new Response('缺少 projectId', { status: 400 })
  try {
    const { descriptor, bytes } = await readArtifact(projectId, (await params).id)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': artifactContentType(descriptor.kind),
        'content-length': String(bytes.length),
        'cache-control': 'private, no-store',
      },
    })
  } catch {
    // 归属错误一律 404 且不回显内部信息（routing.md §9.2）。
    return new Response('产物不存在', { status: 404 })
  }
}
