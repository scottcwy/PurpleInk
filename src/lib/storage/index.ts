import 'server-only'
import { ARTIFACTS_DIR } from '@/lib/config/paths'
import { LocalFsStorage } from './local-fs'
import { S3MirrorStorage } from './s3-mirror'
import { S3RemoteStore } from './s3-remote-store'
import type { StorageAdapter } from './types'

type StorageEnvironment = Record<string, string | undefined>

export function createStorage(
  environment: StorageEnvironment = process.env,
  artifactsDirectory = ARTIFACTS_DIR,
): StorageAdapter {
  const local = new LocalFsStorage(artifactsDirectory)
  const mode = environment.STORAGE_MODE?.trim() || 'local'
  if (mode === 'local') return local
  if (mode !== 's3-mirror') {
    throw new Error('未知 STORAGE_MODE（可选 local | s3-mirror）')
  }
  return new S3MirrorStorage(local, new S3RemoteStore({
    endpoint: requireEnvironment(environment, 'S3_ENDPOINT'),
    bucket: requireEnvironment(environment, 'S3_BUCKET'),
    region: environment.S3_REGION?.trim() || undefined,
    accessKeyId: requireEnvironment(environment, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnvironment(environment, 'S3_SECRET_ACCESS_KEY'),
  }))
}

function requireEnvironment(
  environment: StorageEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(`STORAGE_MODE=s3-mirror 需要环境变量 ${name}`)
  }
  return value
}

/** Process-wide artifact storage; local remains the default development mode. */
export const storage = createStorage()

export { LocalFsStorage } from './local-fs'
export { S3MirrorStorage } from './s3-mirror'
export { S3RemoteStore } from './s3-remote-store'
export type { RemoteObjectStore } from './remote-store'
export type { StorageAdapter } from './types'
