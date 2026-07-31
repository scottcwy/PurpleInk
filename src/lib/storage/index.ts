import 'server-only'
import { ARTIFACTS_DIR } from '@/lib/config/paths'
import { LocalFsStorage } from './local-fs'
import { S3MirrorStorage } from './s3-mirror'
import { S3RemoteStore } from './s3-remote-store'
import type { StorageAdapter } from './types'

/** 预签名下载 URL 默认时效（秒），可用 S3_PRESIGN_TTL_SECONDS 覆盖。 */
export const PRESIGN_TTL_SECONDS = (() => {
  const parsed = Number(process.env.S3_PRESIGN_TTL_SECONDS ?? '300')
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 300
})()

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`STORAGE_MODE=s3-mirror 需要环境变量 ${name}（仅缺变量名，不回显值）`)
  }
  return value
}

function createStorage(): StorageAdapter {
  const local = new LocalFsStorage(ARTIFACTS_DIR)
  const mode = process.env.STORAGE_MODE?.trim() || 'local'
  if (mode === 'local') return local
  if (mode === 's3-mirror') {
    return new S3MirrorStorage(
      local,
      new S3RemoteStore({
        endpoint: requireEnv('S3_ENDPOINT'),
        bucket: requireEnv('S3_BUCKET'),
        accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
        region: process.env.S3_REGION?.trim() || undefined,
      })
    )
  }
  throw new Error(`未知 STORAGE_MODE: ${mode}（可选 local | s3-mirror）`)
}

/** 进程内存储单例；local 模式下即原本地 FS（根为 DATA_DIR/artifacts），行为不变。 */
export const storage = createStorage()

export { LocalFsStorage } from './local-fs'
export { S3MirrorStorage } from './s3-mirror'
export { S3RemoteStore } from './s3-remote-store'
export type { RemoteObjectStore } from './remote-store'
export type { StorageAdapter } from './types'
