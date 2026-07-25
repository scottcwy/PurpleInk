import { createHash, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  commitArtifactRecord,
  resolveCurrentAttemptId,
} from '@/features/artifacts'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { canvasNodes } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import { patchNodePayload } from './runtime-node-data'
import type { PreparedStageResult } from './stage-result'
import type { ArtifactCommitResult } from './tools/write-artifact'
import type { PipelineStage } from './types'

export const directorStorageKeySchema = z
  .string()
  .min(1)
  .regex(/^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\).+$/, {
    message: 'artifact storageKey 必须是安全相对路径',
  })

export interface ArtifactPointerInput {
  projectId: string
  nodeId: string
  kind: string
  storageKey: string
  contentHash?: string
}

export class DirectorArtifactWriter {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageAdapter
  ) {}

  async registerPointer(input: ArtifactPointerInput): Promise<string> {
    const storageKey = directorStorageKeySchema.parse(input.storageKey)
    const bytes = await this.storage.get(storageKey)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    if (input.contentHash && input.contentHash !== contentHash) {
      throw new Error('artifact pointer content hash 不匹配')
    }
    const attemptId = await this.resolveNodeAttempt(input.projectId, input.nodeId)
    const id = randomUUID()
    try {
      await commitArtifactRecord(this.db, {
        workspaceId: LOCAL_WORKSPACE_ID,
        projectId: input.projectId,
        aggregateType: 'node',
        aggregateId: input.nodeId,
        kind: input.kind,
        schemaVersion: 'cvc.director-pointer/v1',
        storageKey,
        sizeBytes: bytes.byteLength,
        contentHash,
        attemptId,
        id,
      })
      return id
    } catch (error) {
      return compensateStorage(this.storage, storageKey, error)
    }
  }

  async persistStreamLog(
    projectId: string,
    nodeId: string,
    stage: PipelineStage,
    text: string
  ): Promise<void> {
    if (!text) return
    const attemptId = await this.resolveNodeAttempt(projectId, nodeId)
    const slug = stage.toLowerCase().replaceAll('_', '-')
    const storageKey = `director-stream/${projectId}/${nodeId}/${slug}.log`
    const existed = await this.storage.exists(storageKey)
    await this.storage.put(storageKey, text)
    try {
      await commitArtifactRecord(this.db, {
        workspaceId: LOCAL_WORKSPACE_ID,
        projectId,
        aggregateType: 'node',
        aggregateId: nodeId,
        kind: 'director-stream-log',
        schemaVersion: 'cvc.director-stream-log/v1',
        storageKey,
        sizeBytes: Buffer.byteLength(text),
        contentHash: createHash('sha256').update(text).digest('hex'),
        attemptId,
      })
    } catch (error) {
      if (!existed) return compensateStorage(this.storage, storageKey, error)
      throw error
    }
  }

  async recordStageOutput(
    nodeId: string,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult
  ): Promise<void> {
    assertArtifactMatchesNode(nodeId, artifact)
    try {
      await commitArtifactRecord(
        this.db,
        {
          workspaceId: artifact.workspaceId,
          projectId: artifact.projectId,
          aggregateType: artifact.aggregateType,
          aggregateId: artifact.aggregateId,
          kind: artifact.kind,
          schemaVersion: artifact.schemaVersion,
          storageKey: artifact.storageKey,
          sizeBytes: artifact.sizeBytes,
          contentHash: artifact.contentHash,
          attemptId: artifact.attemptId,
          id: artifact.id,
        },
        async (transaction, artifactId) => {
          const [node] = await transaction
            .select({ data: canvasNodes.data })
            .from(canvasNodes)
            .where(
              and(
                eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
                eq(canvasNodes.projectId, artifact.projectId),
                eq(canvasNodes.id, nodeId)
              )
            )
            .limit(1)
          if (!node) throw new Error(`节点不存在：${nodeId}`)
          await transaction
            .update(canvasNodes)
            .set({
              data: patchNodePayload(node.data, {
                directorArtifactId: artifactId,
                ...(result.renderSpec ? { renderSpec: result.renderSpec } : {}),
              }),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
                eq(canvasNodes.id, nodeId)
              )
            )
        }
      )
    } catch (error) {
      if (!artifact.storageKeyAlreadyExisted) {
        return compensateStorage(this.storage, artifact.storageKey, error)
      }
      throw error
    }
  }

  private async resolveNodeAttempt(
    projectId: string,
    nodeId: string
  ): Promise<string> {
    return resolveCurrentAttemptId(this.db, {
      workspaceId: LOCAL_WORKSPACE_ID,
      projectId,
      aggregateType: 'node',
      aggregateId: nodeId,
    })
  }
}

function assertArtifactMatchesNode(
  nodeId: string,
  artifact: ArtifactCommitResult
): void {
  if (
    artifact.workspaceId !== LOCAL_WORKSPACE_ID ||
    artifact.aggregateType !== 'node' ||
    artifact.aggregateId !== nodeId
  ) {
    throw new Error('Director artifact 与 node 投影不匹配')
  }
}

async function compensateStorage(
  storage: StorageAdapter,
  storageKey: string,
  failure: unknown
): Promise<never> {
  try {
    await storage.delete(storageKey)
  } catch (cleanupError) {
    throw new AggregateError(
      [failure, cleanupError],
      'artifact 提交失败且存储补偿不完整'
    )
  }
  throw failure
}
