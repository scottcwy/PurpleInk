import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  commitArtifactRecord,
  commitDerivedArtifact,
  resolveCurrentAttemptId,
  resolveDerivedSourceAttemptId,
} from '@/features/artifacts'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import { writeNodeProjection } from './persistence'
import { RenderShotRepository } from './render-shot-repository'
import { FRAME_THUMBNAIL_KIND, thumbnailOutputPath } from './types'
import type {
  ShotQaVisionData,
  ThumbnailArtifactRecord,
} from './types'

export interface FinalArtifactInput {
  projectId: string
  outputKey: string
  contentHash: string
  sizeBytes: number
}

/** 降级导出的占位/未验收清单（JSON 字节）：与 final-mp4 同一 project attempt 提交。 */
export interface DegradedManifestInput {
  projectId: string
  storageKey: string
  contentHash: string
  sizeBytes: number
}

export interface FinalArtifactRecord {
  artifactId: string
  path: string
  contentHash: string
  schemaVersion: string
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
    const attemptId = await resolveCurrentAttemptId(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
    })
    const committed = await commitArtifactRecord(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
      kind: 'final-mp4',
      schemaVersion: 'cvc.final-video/v2',
      storageKey: input.outputKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      attemptId,
    })
    return committed.artifactId
  }

  async findLatestFinalArtifact(
    projectId: string
  ): Promise<FinalArtifactRecord | null> {
    const database = await this.database()
    const [row] = await database
      .select({
        id: artifacts.id,
        storageKey: artifacts.storageKey,
        contentHash: artifacts.contentHash,
        schemaVersion: artifacts.schemaVersion,
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
          path: row.storageKey,
          contentHash: row.contentHash,
          schemaVersion: row.schemaVersion,
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
    const attemptId = await resolveCurrentAttemptId(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
    })
    const committed = await commitArtifactRecord(database, {
      workspaceId: currentWorkspaceId(),
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
      kind: 'final-mp4-degraded-manifest',
      schemaVersion: 'cvc.final-degraded-manifest/v2',
      storageKey: input.storageKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      attemptId,
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
