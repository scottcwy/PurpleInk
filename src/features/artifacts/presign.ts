import { artifactContentType } from './content-type'
import { artifactDownloadFilename, attachmentDisposition } from './download'

export interface PresignResponseOverrides {
  contentType?: string
  contentDisposition?: string
}

export interface PresignDownloadOptions {
  expectedContentSha256?: string
  response: PresignResponseOverrides
}

export interface PresignCapableStorage {
  presignDownloadUrl(
    key: string,
    ttlSeconds: number,
    options: PresignDownloadOptions,
  ): Promise<string>
}

export interface PresignArtifactInput {
  storageKey: string
  kind: string
  contentHash: string | null
  attachment: boolean
  ttlSeconds: number
}

export function supportsPresignedDownload(
  adapter: unknown,
): adapter is PresignCapableStorage {
  return typeof adapter === 'object'
    && adapter !== null
    && typeof (adapter as { presignDownloadUrl?: unknown }).presignDownloadUrl
      === 'function'
}

export async function presignArtifactDownload(
  adapter: unknown,
  input: PresignArtifactInput,
): Promise<string | null> {
  if (!supportsPresignedDownload(adapter)) return null
  const protectedVideo = input.kind === 'final-mp4'
    || input.kind === 'website-video-mp4'
  if (protectedVideo && !isSha256(input.contentHash)) {
    throw new Error('受保护产物缺少有效 content hash')
  }
  return adapter.presignDownloadUrl(input.storageKey, input.ttlSeconds, {
    ...(protectedVideo ? { expectedContentSha256: input.contentHash! } : {}),
    response: {
      contentType: artifactContentType(input.kind),
      ...(input.attachment
        ? {
            contentDisposition: attachmentDisposition(
              artifactDownloadFilename(input),
            ),
          }
        : {}),
    },
  })
}

function isSha256(value: string | null): value is string {
  return value !== null && /^[a-f0-9]{64}$/u.test(value)
}
