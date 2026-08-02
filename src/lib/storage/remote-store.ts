/** Narrow durable object-store port used by the mirrored storage adapter. */
export interface RemoteObjectStore {
  putObject(key: string, data: Buffer): Promise<void>
  getObject(key: string): Promise<Buffer | null>
  hasObject(key: string): Promise<boolean>
  deleteObject(key: string): Promise<void>
}
