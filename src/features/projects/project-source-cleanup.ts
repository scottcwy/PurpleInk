import 'server-only'
import { z } from 'zod'
import type { Db } from '@/lib/db/client'
import { STORAGE_CLEANUP_REASONS } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import {
  drainStorageCleanupRequest,
  enqueueStorageCleanupRequest,
} from '@/lib/storage/cleanup-outbox'

const cleanupRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  storageKey: z.string().regex(
    /^project-sources\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(?:mp3|wav)$/u,
  ),
  reason: z.enum(STORAGE_CLEANUP_REASONS),
})

export type ProjectSourceCleanupRequest = z.infer<typeof cleanupRequestSchema>

export async function deferProjectSourceCleanup(
  input: ProjectSourceCleanupRequest,
  dependencies: { database?: Db } = {},
): Promise<void> {
  const request = cleanupRequestSchema.parse(input)
  await enqueueStorageCleanupRequest(request, dependencies)
}

export async function cleanupProjectSourceUpload(
  input: ProjectSourceCleanupRequest,
  dependencies: {
    database?: Db
    storage: Pick<StorageAdapter, 'delete'>
  },
): Promise<void> {
  const request = cleanupRequestSchema.parse(input)
  await enqueueStorageCleanupRequest(request, dependencies)
  const result = await drainStorageCleanupRequest(
    {
      workspaceId: request.workspaceId,
      storageKey: request.storageKey,
    },
    dependencies,
  )
  if (result.deferred > 0) {
    throw new Error('STORAGE_DELETE_FAILED')
  }
}
