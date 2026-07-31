import { artifactContentType } from './content-type'
import { artifactDownloadFilename, attachmentDisposition } from './download'

/**
 * 产物下载的预签名接缝。
 *
 * local 模式的存储没有远端可签，函数返回 null，路由继续走原字节流路径；
 * s3-mirror 模式返回限时 URL，路由 302，字节不经过 Next 进程。
 * 完整性口径：302 分支不做全字节 SHA-256（字节不在手上），信任写穿时的远端
 * 确认与提交时按实际字节计算的 content_hash；字节流路径的全量校验原样保留。
 */

/** 预签名 GET 的响应头覆盖：上传时未存对象 content-type，取回时必须补。 */
export interface PresignResponseOverrides {
  contentType?: string
  contentDisposition?: string
}

/** 结构化能力探测目标，与 S3MirrorStorage.presignDownloadUrl 同形。 */
export interface PresignCapableStorage {
  presignDownloadUrl(
    key: string,
    ttlSeconds: number,
    response?: PresignResponseOverrides
  ): Promise<string>
}

export function supportsPresignedDownload(
  adapter: unknown
): adapter is PresignCapableStorage {
  return (
    typeof adapter === 'object'
    && adapter !== null
    && typeof (adapter as Record<string, unknown>).presignDownloadUrl === 'function'
  )
}

export interface PresignArtifactInput {
  storageKey: string
  kind: string
  contentHash: string | null
  attachment: boolean
  ttlSeconds: number
}

export async function presignArtifactDownload(
  adapter: unknown,
  input: PresignArtifactInput
): Promise<string | null> {
  if (!supportsPresignedDownload(adapter)) return null
  return adapter.presignDownloadUrl(input.storageKey, input.ttlSeconds, {
    contentType: artifactContentType(input.kind),
    ...(input.attachment
      ? {
          contentDisposition: attachmentDisposition(
            artifactDownloadFilename(input)
          ),
        }
      : {}),
  })
}
