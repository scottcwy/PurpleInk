import 'server-only'
import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import { detectAudioContainer, type AudioContainer } from './audio-format'
import { narrationArtifactKind } from './narration-repository'

export interface LoadedNarration {
  unitId: string
  audioArtifactId: string
  audioKey: string
  audioBytes: Buffer
  /** 由真实字节判定，不写死为 MP3：TTS 路由切换后旁白可能是 WAV。 */
  audioFormat: AudioContainer
  contentHash: string
  sizeBytes: number
}

/**
 * 恢复 INGEST 阶段已产出的旁白音频。
 *
 * 下游（音效编排、字幕 ASR）只消费这份音频，不再二次合成，
 * 避免同一分镜出现两份不同的语音。
 */
export class AudioRuntimeRepository {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageAdapter
  ) {}

  async loadNarration(
    projectId: string,
    unitId: string
  ): Promise<LoadedNarration> {
    const kind = narrationArtifactKind(unitId)
    const [artifact] = await this.db
      .select({
        id: artifacts.id,
        storageKey: artifacts.storageKey,
        contentHash: artifacts.contentHash,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.kind, kind)
        )
      )
      .orderBy(
        desc(artifacts.version),
        desc(artifacts.createdAt),
        desc(artifacts.id)
      )
      .limit(1)
    if (!artifact) {
      throw new Error(`找不到 ${kind} 产物：INGEST 尚未产出该单元的旁白`)
    }
    const audioBytes = await this.storage.get(artifact.storageKey)
    const actualHash = createHash('sha256').update(audioBytes).digest('hex')
    if (actualHash !== artifact.contentHash) {
      throw new Error(`旁白音频实体与索引 hash 不一致：${artifact.storageKey}`)
    }
    return {
      unitId,
      audioArtifactId: artifact.id,
      audioKey: artifact.storageKey,
      audioBytes,
      audioFormat: detectAudioContainer(audioBytes),
      contentHash: actualHash,
      sizeBytes: audioBytes.byteLength,
    }
  }
}
