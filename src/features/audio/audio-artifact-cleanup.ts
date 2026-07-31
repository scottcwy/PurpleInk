import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import {
  drainStorageCleanupRequest,
  drainStorageCleanupRequests,
  enqueueStorageCleanupRequest,
} from '@/lib/storage/cleanup-outbox'
import type { StorageAdapter } from '@/lib/storage'
import type { AudioArtifactCleanup } from './user-audio-artifacts'

interface CleanupInput {
  projectId: string
  nodeId: string
  attemptId: string
  storageKey: string
}

/** 将录音登记失败的对象交给公共持久清理 outbox，并立即补偿当前 key。 */
export class AudioArtifactCleanupService implements AudioArtifactCleanup {
  constructor(
    private readonly db: Db,
    private readonly storage: Pick<StorageAdapter, 'delete'>,
  ) {}

  async discard(input: CleanupInput): Promise<void> {
    const workspaceId = currentWorkspaceId()
    await enqueueStorageCleanupRequest({
      workspaceId,
      ...input,
      reason: 'artifact-registration-failed',
    }, { database: this.db })
    const result = await drainStorageCleanupRequest(
      { workspaceId, storageKey: input.storageKey },
      { database: this.db, storage: this.storage },
    )
    if (result.deferred > 0) {
      throw new Error('STORAGE_DELETE_FAILED')
    }
  }

  async drainPending(limit = 100) {
    return drainStorageCleanupRequests(
      { workspaceId: currentWorkspaceId(), limit },
      { database: this.db, storage: this.storage },
    )
  }
}
