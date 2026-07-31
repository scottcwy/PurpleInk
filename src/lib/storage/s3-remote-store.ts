import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { PresignGetOverrides, RemoteObjectStore } from './remote-store'

/** S3 兼容端配置；R2 / Supabase Storage / MinIO 只是 endpoint 与密钥不同。 */
export interface S3RemoteStoreConfig {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** R2 固定用 'auto'；其余 S3 兼容端按各自要求。 */
  region?: string
}

/** 判定 SDK 错误是否为「对象不存在」，其余错误如实上抛。 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
    ?.httpStatusCode
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404
}

/** 基于 AWS SDK 的 S3 兼容远端实现。path-style 寻址以兼容 R2 / MinIO。 */
export class S3RemoteStore implements RemoteObjectStore {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: S3RemoteStoreConfig) {
    this.bucket = config.bucket
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region ?? 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    })
  }

  async putObject(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data })
    )
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      )
      const bytes = await response.Body?.transformToByteArray()
      return bytes ? Buffer.from(bytes) : null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async hasObject(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      )
      return true
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    )
  }

  async presignGetUrl(
    key: string,
    ttlSeconds: number,
    response?: PresignGetOverrides
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: response?.contentType,
        ResponseContentDisposition: response?.contentDisposition,
      }),
      { expiresIn: ttlSeconds }
    )
  }
}
