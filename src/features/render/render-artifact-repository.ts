import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  commitArtifactRecord,
  commitArtifactRecords,
  commitDerivedArtifact,
  resolveCurrentAttemptId,
  resolveDerivedSourceAttemptId,
} from '@/features/artifacts'
import type { SubtitleDeliveryMode } from '@/features/canvas/export-settings'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import { finalVideoSchemaVersion } from './final-video-delivery'
import { writeNodeProjection } from './persistence'
import { RenderShotRepository } from './render-shot-repository'
import { FRAME_THUMBNAIL_KIND, thumbnailOutputPath } from './types'
import type {
  ShotQaVisionData,
  ThumbnailArtifactRecord,
} from './types'

export interface FinalArtifactInput {
  projectId: string
  attemptId: string
  outputKey: string
  contentHash: string
  sizeBytes: number
  /** 本次成片的字幕交付形态，决定写入的 schemaVersion。 */
  subtitles: SubtitleDeliveryMode
}

/** 降级导出的占位/未验收清单（JSON 字节）：与 final-mp4 同一 project attempt 提交。 */
export interface DegradedManifestInput {
  projectId: string
  attemptId: string
  storageKey: string
  contentHash: string
  sizeBytes: number
}

export interface FinalDeliveryInput {
  projectId: string
  attemptId: string
  outputKey: string
  finalContentHash: string
  finalSizeBytes: number
  subtitles: SubtitleDeliveryMode
  soundEffectsManifest: {
    storageKey: string
    contentHash: string
    sizeBytes: number
  }
  degradedManifest?: {
    storageKey: string
    contentHash: string
    sizeBytes: number
  }
}

export interface FinalArtifactRecord {
  artifactId: string
  attemptId: string
  path: string
  contentHash: string
  schemaVersion: string
  sizeBytes: number
}

export interface ThumbnailRegistration {
  projectId: string
  nodeId: string
  outputKey: string
  contentHash: string
  sizeBytes: number
}

export interface VisionReportRegistration extends ThumbnailRegistration {
  buildProjection(artifactId: string): ShotQaVisionData
}

export class RenderArtifactRepository extends RenderShotRepository {
  async registerFinalArtifact(input: FinalArtifactInput): Promise<string> {
    const database = await this.database()
    const committed = await commitArtifactRecord(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
      kind: 'final-mp4',
      schemaVersion: finalVideoSchemaVersion(input.subtitles),
      storageKey: input.outputKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      attemptId: input.attemptId,
    })
    return committed.artifactId
  }

  async registerFinalDelivery(
    input: FinalDeliveryInput
  ): Promise<{
    finalArtifactId: string
    soundEffectsManifestArtifactId: string
    degradedManifestArtifactId: string | null
  }> {
    const workspaceId = currentWorkspaceId()
    const shared = {
      workspaceId,
      projectId: input.projectId,
      aggregateType: 'project' as const,
      aggregateId: input.projectId,
      attemptId: input.attemptId,
    }
    const committed = await commitArtifactRecords(await this.database(), [
      {
        ...shared,
        kind: 'final-mp4',
        schemaVersion: finalVideoSchemaVersion(input.subtitles),
        storageKey: input.outputKey,
        sizeBytes: input.finalSizeBytes,
        contentHash: input.finalContentHash,
      },
      {
        ...shared,
        kind: 'procedural-sfx-manifest',
        schemaVersion: 'cvc.procedural-sfx-manifest/v1',
        ...input.soundEffectsManifest,
      },
      ...(input.degradedManifest
        ? [
            {
              ...shared,
              kind: 'final-mp4-degraded-manifest',
              schemaVersion: 'cvc.final-degraded-manifest/v3',
              ...input.degradedManifest,
            },
          ]
        : []),
    ])
    const final = committed[0]
    const soundEffects = committed[1]
    if (!final || !soundEffects) throw new Error('终片 Artifact 批量提交不完整')
    return {
      finalArtifactId: final.artifactId,
      soundEffectsManifestArtifactId: soundEffects.artifactId,
      degradedManifestArtifactId: committed[2]?.artifactId ?? null,
    }
  }

  async findLatestFinalArtifact(
    projectId: string
  ): Promise<FinalArtifactRecord | null> {
    const database = await this.database()
    const [row] = await database
      .select({
        id: artifacts.id,
        attemptId: artifacts.attemptId,
        storageKey: artifacts.storageKey,
        contentHash: artifacts.contentHash,
        schemaVersion: artifacts.schemaVersion,
        sizeBytes: artifacts.sizeBytes,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'project'),
          eq(artifacts.aggregateId, projectId),
          eq(artifacts.kind, 'final-mp4')
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    return row
      ? {
          artifactId: row.id,
          attemptId: row.attemptId,
          path: row.storageKey,
          contentHash: row.contentHash,
          schemaVersion: row.schemaVersion,
          sizeBytes: row.sizeBytes,
        }
      : null
  }

  /**
   * 登记降级导出的交付清单（真实 JSON 字节已落盘）。内容含 `finalContentHash`
   * 与当次 final-mp4 精确对应，读取时据此判定“最新成片是否为降级产物”。
   */
  async registerDegradedManifest(
    input: DegradedManifestInput
  ): Promise<string> {
    const database = await this.database()
    const committed = await commitArtifactRecord(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
      kind: 'final-mp4-degraded-manifest',
      schemaVersion: 'cvc.final-degraded-manifest/v3',
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      attemptId: input.attemptId,
    })
    return committed.artifactId
  }

  async findThumbnail(
    projectId: string,
    nodeId: string,
    sourceKey: string,
    frame: number
  ): Promise<ThumbnailArtifactRecord | null> {
    const database = await this.database()
    const storageKey = thumbnailOutputPath(
      projectId,
      nodeId,
      sourceKey,
      frame
    )
    const [row] = await database
      .select({ id: artifacts.id, contentHash: artifacts.contentHash })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.aggregateId, nodeId),
          eq(artifacts.kind, FRAME_THUMBNAIL_KIND),
          eq(artifacts.storageKey, storageKey)
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    return row
      ? { artifactId: row.id, path: storageKey, contentHash: row.contentHash }
      : null
  }

  /**
   * 逐帧缩略图是 `director-fabricate` HTML 的确定性再加工，按需生成于三种场景：
   * 渲染后的 Final QA、shot-qa 阶段（running attempt 属于 QA 节点而非 codegen 节点）、
   * 以及分镜页浏览（完全没有 running attempt）。因此它走派生产物提交路径，
   * 归属继承来源 HTML 的 attempt，而不是要求「当前有 running attempt」。
   */
  async registerThumbnail(input: ThumbnailRegistration): Promise<string> {
    const database = await this.database()
    const attemptId = await resolveDerivedSourceAttemptId(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'node',
      aggregateId: input.nodeId,
      sourceKind: 'director-fabricate',
    })
    const committed = await commitDerivedArtifact(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'node',
      aggregateId: input.nodeId,
      kind: FRAME_THUMBNAIL_KIND,
      schemaVersion: 'cvc.frame-thumbnail/v1',
      storageKey: input.outputKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      attemptId,
    })
    return committed.artifactId
  }

  async registerVisionReport(
    input: VisionReportRegistration
  ): Promise<{ artifactId: string; qaVision: ShotQaVisionData }> {
    const database = await this.database()
    const attemptId = await this.nodeAttempt(database, input)
    const committed = await commitArtifactRecord(
      database,
      {
        workspaceId: currentWorkspaceId(),
        projectId: input.projectId,
        aggregateType: 'node',
        aggregateId: input.nodeId,
        kind: 'qa-vision-report',
        schemaVersion: 'cvc.qa-vision-report/v1',
        storageKey: input.outputKey,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash,
        attemptId,
      },
      async (transaction, artifactId) => {
        const qaVision = input.buildProjection(artifactId)
        await writeNodeProjection(
          transaction,
          input.nodeId,
          'qaVision',
          qaVision
        )
        return qaVision
      }
    )
    if (!committed.projection) throw new Error('Vision QA 投影提交失败')
    return {
      artifactId: committed.artifactId,
      qaVision: committed.projection,
    }
  }

  protected async latestMusicKey(projectId: string): Promise<string | null> {
    const database = await this.database()
    const [row] = await database
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.kind, 'score-audio')
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    return row?.storageKey ?? null
  }

  private async nodeAttempt(
    database: Db,
    input: { projectId: string; nodeId: string }
  ): Promise<string> {
    return resolveCurrentAttemptId(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'node',
      aggregateId: input.nodeId,
    })
  }
}
