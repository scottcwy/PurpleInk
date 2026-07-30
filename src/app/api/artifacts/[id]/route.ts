import {
  artifactContentType,
  attachmentDisposition,
  artifactDownloadFilename,
  readArtifact,
  wantsAttachment,
} from '@/features/artifacts'
import { withApiSession } from '@/features/auth/api-session'

export const dynamic = 'force-dynamic'

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return withApiSession(() => handleGet(request, params))
}

async function handleGet(request: Request, params: Promise<{ id: string }>) {
  const query = new URL(request.url).searchParams
  const projectId = query.get('projectId')
  if (!projectId) return new Response('缺少 projectId', { status: 400 })
  try {
    const { descriptor, bytes } = await readArtifact(projectId, (await params).id)
    // 不带 download 时保持内联：画布检查器与成片预览都靠内联播放。
    const attachment = wantsAttachment(query.get('download'))
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': artifactContentType(descriptor.kind),
        'content-length': String(bytes.length),
        'cache-control': 'private, no-store',
        ...(attachment
          ? {
              'content-disposition': attachmentDisposition(
                artifactDownloadFilename(descriptor)
              ),
            }
          : {}),
      },
    })
  } catch {
    // 归属错误一律 404 且不回显内部信息（routing.md §9.2）。
    return new Response('产物不存在', { status: 404 })
  }
}
