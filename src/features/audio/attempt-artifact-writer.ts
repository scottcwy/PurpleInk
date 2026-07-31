import 'server-only'
import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { commitArtifactRecord } from '@/features/artifacts'
import {
  directorStorageKeySchema,
  type ArtifactPointerInput,
} from '@/features/director/runtime-artifact-writer'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'

export interface AttemptArtifactPointerInput extends ArtifactPointerInput {
  attemptId: string
}

/**
 * 音频 attempt 内的幂等 Artifact 登记器。
 *
 * 同一 attempt 重放时只接受完全相同的 storage/hash/size，不生成新版本，也不修改
 * 已有记录；新 attempt 仍通过 commitArtifactRecord 正常追加版本并保留谱系。
 */
export class AudioAttemptArtifactWriter {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageAdapter,
  ) {}

  async registerPointer(input: AttemptArtifactPointerInput): Promise<string> {
    const storageKey = directorStorageKeySchema.parse(input.storageKey)
    const bytes = await this.storage.get(storageKey)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    if (input.contentHash && input.contentHash !== contentHash) {
      throw new Error('audio artifact pointer content hash 不匹配')
    }
    const workspaceId = currentWorkspaceId()
    const identity =
      input.kind === 'user-audio-source'
        ? and(
            eq(artifacts.workspaceId, workspaceId),
            eq(artifacts.projectId, input.projectId),
            eq(artifacts.aggregateType, 'node'),
            eq(artifacts.aggregateId, input.nodeId),
            eq(artifacts.kind, input.kind),
            eq(artifacts.attemptId, input.attemptId),
          )
        : and(
            eq(artifacts.workspaceId, workspaceId),
            eq(artifacts.projectId, input.projectId),
            eq(artifacts.aggregateType, 'node'),
            eq(artifacts.aggregateId, input.nodeId),
            eq(artifacts.kind, input.kind),
            eq(artifacts.attemptId, input.attemptId),
            eq(artifacts.storageKey, storageKey),
          )
    const [existing] = await this.db
      .select({
        id: artifacts.id,
        storageKey: artifacts.storageKey,
        contentHash: artifacts.contentHash,
        sizeBytes: artifacts.sizeBytes,
      })
      .from(artifacts)
      .where(identity)
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    if (existing) {
      if (
        existing.storageKey !== storageKey ||
        existing.contentHash !== contentHash ||
        existing.sizeBytes !== bytes.byteLength
      ) {
        throw new Error('同一 audio attempt 的 Artifact 证据不一致')
      }
      return existing.id
    }
    const artifactId = stableArtifactId(
      input,
      input.kind === 'user-audio-source' ? '' : storageKey,
    )
    try {
      const committed = await commitArtifactRecord(this.db, {
        workspaceId,
        projectId: input.projectId,
        aggregateType: 'node',
        aggregateId: input.nodeId,
        kind: input.kind,
        schemaVersion: 'cvc.director-pointer/v1',
        storageKey,
        sizeBytes: bytes.byteLength,
        contentHash,
        attemptId: input.attemptId,
        id: artifactId,
      })
      return committed.artifactId
    } catch (error) {
      const [raced] = await this.db
        .select({
          id: artifacts.id,
          contentHash: artifacts.contentHash,
          sizeBytes: artifacts.sizeBytes,
        })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.workspaceId, workspaceId),
            eq(artifacts.id, artifactId),
            eq(artifacts.storageKey, storageKey),
          ),
        )
        .limit(1)
      if (
        raced?.contentHash === contentHash &&
        raced.sizeBytes === bytes.byteLength
      ) {
        return raced.id
      }
      throw error
    }
  }
}

function stableArtifactId(
  input: Pick<
    AttemptArtifactPointerInput,
    'attemptId' | 'kind'
  >,
  storageKey: string,
): string {
  const hex = createHash('sha256')
    .update(`${input.attemptId}\0${input.kind}\0${storageKey}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '4'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-')
}
