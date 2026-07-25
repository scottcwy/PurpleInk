import { artifactContentType, readArtifact } from '@/features/artifacts'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  } catch (error) {
    return new Response(error instanceof Error ? error.message : '产物读取失败', { status: 404 })
  }
}
