import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  PresignGetResponseOverrides,
  RemoteObjectStore,
  RemotePutOptions,
} from './remote-store'
import { canonicalizeStorageKey } from './storage-key'

export interface S3RemoteStoreConfig {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

/** S3-compatible durable object storage configured for R2 path-style access. */
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

  async putObject(
    key: string,
    data: Buffer,
    options?: RemotePutOptions,
  ): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: canonicalizeStorageKey(key),
      Body: data,
      Metadata: options?.metadata,
    }))
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: canonicalizeStorageKey(key),
      }))
      const bytes = await response.Body?.transformToByteArray()
      return bytes ? Buffer.from(bytes) : null
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async hasObject(key: string): Promise<boolean> {
    return (await this.getObjectMetadata(key)) !== null
  }

  async getObjectMetadata(key: string): Promise<Record<string, string> | null> {
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: canonicalizeStorageKey(key),
      }))
      return Object.fromEntries(
        Object.entries(response.Metadata ?? {}).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      )
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async presignGetUrl(
    key: string,
    ttlSeconds: number,
    response?: PresignGetResponseOverrides,
  ): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: canonicalizeStorageKey(key),
      ResponseContentType: response?.contentType,
      ResponseContentDisposition: response?.contentDisposition,
    }), { expiresIn: ttlSeconds })
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: canonicalizeStorageKey(key),
    }))
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const named = error as {
    name?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  return named.name === 'NoSuchKey'
    || named.name === 'NotFound'
    || named.$metadata?.httpStatusCode === 404
}
