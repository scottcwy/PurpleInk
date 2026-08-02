export interface RemotePutOptions {
  metadata?: Record<string, string>
}

export interface PresignGetResponseOverrides {
  contentType?: string
  contentDisposition?: string
}

/** Narrow durable object-store port used by the mirrored storage adapter. */
export interface RemoteObjectStore {
  putObject(key: string, data: Buffer, options?: RemotePutOptions): Promise<void>
  getObject(key: string): Promise<Buffer | null>
  getObjectMetadata(key: string): Promise<Record<string, string> | null>
  hasObject(key: string): Promise<boolean>
  presignGetUrl(
    key: string,
    ttlSeconds: number,
    response?: PresignGetResponseOverrides,
  ): Promise<string>
  deleteObject(key: string): Promise<void>
}
