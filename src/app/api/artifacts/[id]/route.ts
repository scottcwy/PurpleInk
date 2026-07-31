import { createHash } from 'node:crypto'
import {
  artifactContentType,
  attachmentDisposition,
  artifactDownloadFilename,
  getArtifactDescriptor,
  getArtifactDownloadRedirect,
  readArtifact,
  wantsAttachment,
} from '@/features/artifacts'
import { withApiSession } from '@/features/auth/api-session'
import { getProjectExecutionSnapshot } from '@/features/projects'
import { getExportReadiness } from '@/features/render/export-readiness'

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
    const artifactId = (await params).id
    const candidate = await getArtifactDescriptor(projectId, artifactId)
    if (!candidate) throw new Error('artifact missing')
    if (candidate.kind === 'website-video-mp4') {
      const execution = await getProjectExecutionSnapshot(projectId)
      const delivery = execution.delivery
      if (
        execution.state !== 'succeeded'
        || delivery?.artifactId !== artifactId
        || delivery.lifecycle !== 'approved'
        || !delivery.downloadUrl
      ) {
        throw new Error('website delivery unavailable')
      }
    }
    if (candidate.kind === 'final-mp4') {
      const readiness = await getExportReadiness(projectId)
      if (
        readiness.finalArtifactId !== artifactId
        || !readiness.artifactDownloadable
      ) {
        throw new Error('final delivery unavailable')
      }
    }
    // 不带 download 时保持内联：画布检查器与成片预览都靠内联播放。
    const attachment = wantsAttachment(query.get('download'))
    const verifiedVideo =
      candidate.kind === 'website-video-mp4' || candidate.kind === 'final-mp4'
    // 两种成片无论走哪条路径都必须有可追溯的 content_hash。
    if (verifiedVideo && !candidate.contentHash) {
      throw new Error('website delivery hash missing')
    }
    // s3-mirror 模式：门控通过后 302 到远端预签名 URL，字节不经过 Next 进程。
    // 完整性由写穿时的远端确认 + 提交时按实际字节算出的 content_hash 保证；
    // local 模式返回 null，走下方原字节流路径（含全字节 SHA-256 校验）。
    const redirectUrl = await getArtifactDownloadRedirect(projectId, artifactId, {
      attachment,
    })
    if (redirectUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          location: redirectUrl,
          'cache-control': 'private, no-store',
          ...(verifiedVideo
            ? { 'x-content-sha256': candidate.contentHash ?? '' }
            : {}),
        },
      })
    }
    const { descriptor, bytes } = await readArtifact(projectId, artifactId)
    if (
      (descriptor.kind === 'website-video-mp4' || descriptor.kind === 'final-mp4')
      && (
        !descriptor.contentHash
        || createHash('sha256').update(bytes).digest('hex')
          !== descriptor.contentHash
      )
    ) {
      throw new Error('website delivery hash mismatch')
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': artifactContentType(descriptor.kind),
        'content-length': String(bytes.length),
        'cache-control': 'private, no-store',
        ...(
          descriptor.kind === 'website-video-mp4'
          || descriptor.kind === 'final-mp4'
          ? { 'x-content-sha256': descriptor.contentHash ?? '' }
          : {}),
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
