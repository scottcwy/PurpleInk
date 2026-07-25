import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  commitArtifactRecord,
  resolveCurrentAttemptId,
} from '@/features/artifacts'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
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

export interface FinalArtifactRecord {
  artifactId: string
  path: string
  contentHash: string
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
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
    })
    const committed = await commitArtifactRecord(database, {
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId: input.projectId,
      aggregateType: 'project',
      aggregateId: input.projectId,
      kind: 'final-mp4',
      schemaVersion: 'cvc.final-video/v1',
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
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
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
        }
      : null
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
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
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

  async registerThumbnail(input: ThumbnailRegistration): Promise<string> {
    return this.commitNodeArtifact(
      input,
      FRAME_THUMBNAIL_KIND,
      'cvc.frame-thumbnail/v1'
    )
  }

  async registerVisionReport(
    input: VisionReportRegistration
  ): Promise<{ artifactId: string; qaVision: ShotQaVisionData }> {
    const database = await this.database()
    const attemptId = await this.nodeAttempt(database, input)
    const committed = await commitArtifactRecord(
      database,
      {
        workspaceId: LOCAL_WORKSPACE_ID,
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
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(artifacts.projectId, projectId),
          eq(artifacts.kind, 'score-audio')
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    return row?.storageKey ?? null
  }

  private async commitNodeArtifact(
    input: ThumbnailRegistration,
    kind: string,
    schemaVersion: string
  ): Promise<string> {
    const database = await this.database()
    const attemptId = await this.nodeAttempt(database, input)
    const committed = await commitArtifactRecord(database, {
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId: input.projectId,
      aggregateType: 'node',
      aggregateId: input.nodeId,
      kind,
      schemaVersion,
      storageKey: input.outputKey,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      attemptId,
    })
    return committed.artifactId
  }

  private async nodeAttempt(
    database: Db,
    input: { projectId: string; nodeId: string }
  ): Promise<string> {
    return resolveCurrentAttemptId(database, {
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId: input.projectId,
      aggregateType: 'node',
      aggregateId: input.nodeId,
    })
  }
}
