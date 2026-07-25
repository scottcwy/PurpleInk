import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import type { Caption, SubtitleInput } from './types'

const metadataSchema = z
  .object({
    version: z.literal(1),
    shotId: z.string().min(1),
    model: z.string().min(1),
    durationMs: z.number().int().positive(),
    audioArtifactId: z.string().min(1),
    audioKey: z.string().min(1),
    audioFormat: z.enum(['mp3', 'wav', 'ogg', 'pcm']),
    nativeCaptions: z.array(
      z
        .object({
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().positive(),
          text: z.string().min(1),
        })
        .strict()
    ),
  })
  .strict()

export interface LoadedVoiceover
  extends Pick<
    SubtitleInput,
    'audioArtifactId' | 'audioKey' | 'audioBytes' | 'audioFormat'
  > {
  durationMs: number
  model: string
  nativeCaptions: Caption[]
}

/** 为字幕阶段恢复同项目、同分镜的可信配音产物。 */
export class AudioRuntimeRepository {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageAdapter
  ) {}

  async loadVoiceover(
    projectId: string,
    shotId: string
  ): Promise<LoadedVoiceover> {
    const [node] = await this.db
      .select({ id: canvasNodes.id })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.type, 'shot-sfx'),
          eq(canvasNodes.logicalKey, `shot:${shotId}:shot-sfx`)
        )
      )
      .limit(1)
    if (!node) throw new Error(`找不到 shot-sfx(${shotId}) 节点`)

    const [metadataArtifact] = await this.db
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.aggregateId, node.id),
          eq(artifacts.kind, 'voiceover-metadata')
        )
      )
      .orderBy(
        desc(artifacts.version),
        desc(artifacts.createdAt),
        desc(artifacts.id)
      )
      .limit(1)
    if (!metadataArtifact) {
      throw new Error(`找不到 voiceover-metadata 产物：${shotId}`)
    }

    const metadataBytes = await this.storage.get(metadataArtifact.storageKey)
    const metadata = parseMetadata(metadataBytes, metadataArtifact.storageKey)
    if (metadata.shotId !== shotId) {
      throw new Error(`配音元数据分镜不一致：${metadata.shotId} != ${shotId}`)
    }

    const [audioArtifact] = await this.db
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(artifacts.id, metadata.audioArtifactId),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.aggregateId, node.id),
          eq(artifacts.kind, 'voiceover-audio')
        )
      )
      .limit(1)
    if (!audioArtifact || audioArtifact.storageKey !== metadata.audioKey) {
      throw new Error(`配音元数据与 voiceover-audio 索引不一致：${shotId}`)
    }

    return {
      audioArtifactId: metadata.audioArtifactId,
      audioKey: audioArtifact.storageKey,
      audioBytes: await this.storage.get(audioArtifact.storageKey),
      audioFormat: metadata.audioFormat,
      durationMs: metadata.durationMs,
      model: metadata.model,
      nativeCaptions: metadata.nativeCaptions,
    }
  }
}

function parseMetadata(bytes: Buffer, storageKey: string) {
  try {
    return metadataSchema.parse(JSON.parse(bytes.toString('utf-8')) as unknown)
  } catch (error) {
    throw new Error(`voiceover-metadata 无效：${storageKey}`, { cause: error })
  }
}
