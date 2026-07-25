import 'server-only'
import { and, eq } from 'drizzle-orm'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { canvasNodes, projects } from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import type { StorageAdapter } from '@/lib/storage'
import {
  DirectorArtifactReader,
  type StageContextRow,
} from './runtime-artifact-reader'
import {
  DirectorArtifactWriter,
  directorStorageKeySchema,
  type ArtifactPointerInput,
} from './runtime-artifact-writer'
import {
  fromPersistedNodeStatus,
  patchNodePayload,
  readLaneKey,
  readNodePayload,
} from './runtime-node-data'
import type { PreparedStageResult } from './stage-result'
import type { ArtifactCommitResult } from './tools/write-artifact'
import type { PipelineStage } from './types'

export type { ArtifactPointerInput } from './runtime-artifact-writer'

export interface DirectorStageContext {
  projectId: string
  nodeId: string
  nodeType: string | null
  stage: PipelineStage
  status: 'pending'
  projectTitle: string
  projectScript: string
  directorInput: unknown
  resumeSessionKey?: string
}

/** Director 的 workspace-scoped PG port；构造与模块 import 均不打开连接。 */
export class DirectorRuntimeRepository {
  private readonly reader: DirectorArtifactReader
  private readonly writer: DirectorArtifactWriter

  constructor(
    private readonly db: Db,
    storage: StorageAdapter
  ) {
    this.reader = new DirectorArtifactReader(db, storage)
    this.writer = new DirectorArtifactWriter(db, storage)
  }

  async assertEnqueueable(
    projectId: string,
    nodeId: string,
    stage: PipelineStage
  ): Promise<void> {
    const [node] = await this.db
      .select({
        stage: canvasNodes.stage,
        status: canvasNodes.status,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId),
          eq(canvasNodes.projectId, projectId)
        )
      )
      .limit(1)
    if (!node) throw new Error(`Director 节点不存在或不属于项目：${nodeId}`)
    if (node.stage !== stage) {
      throw new Error(`Director 节点阶段不匹配：${node.stage} != ${stage}`)
    }
    const status = fromPersistedNodeStatus(node.status)
    if (!['idle', 'failed', 'stale'].includes(status)) {
      throw new Error(`Director 节点当前不可入队：${status}`)
    }
  }

  async loadStageContext(
    projectId: string,
    nodeId: string,
    stage: PipelineStage
  ): Promise<DirectorStageContext> {
    const [row] = await this.db
      .select({
        projectTitle: projects.title,
        projectScript: projects.script,
        nodeProjectId: canvasNodes.projectId,
        nodeStage: canvasNodes.stage,
        status: canvasNodes.status,
        data: canvasNodes.data,
        nodeType: canvasNodes.type,
      })
      .from(canvasNodes)
      .innerJoin(
        projects,
        and(
          eq(projects.workspaceId, canvasNodes.workspaceId),
          eq(projects.id, canvasNodes.projectId)
        )
      )
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId),
          eq(projects.id, projectId)
        )
      )
      .limit(1)
    if (!row) throw new Error(`Director 节点不存在或不属于项目：${nodeId}`)
    if (row.nodeStage !== stage) {
      throw new Error(`Director 节点阶段不匹配：${row.nodeStage} != ${stage}`)
    }
    const status = fromPersistedNodeStatus(row.status)
    if (status !== 'pending' && !(status === 'running' && stage === 'FABRICATE')) {
      throw new Error(
        `Director 节点必须为 pending 或 FABRICATE 运行中，当前为：${status}`
      )
    }
    const contextRow: StageContextRow = {
      ...row,
      laneKey: readLaneKey(row.data),
    }
    return {
      projectId,
      nodeId,
      nodeType: row.nodeType,
      stage,
      status: 'pending',
      projectTitle: row.projectTitle,
      projectScript: row.projectScript,
      directorInput: await this.reader.resolveDirectorInput(contextRow, stage),
      resumeSessionKey: readResumeSessionKey(row.data),
    }
  }

  registerArtifactPointer(input: ArtifactPointerInput): Promise<string> {
    return this.writer.registerPointer(input)
  }

  persistStreamLog(
    projectId: string,
    nodeId: string,
    stage: PipelineStage,
    text: string
  ): Promise<void> {
    return this.writer.persistStreamLog(projectId, nodeId, stage, text)
  }

  async recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await this.updateNodePayload(nodeId, {
      directorError: { stage, message },
    })
  }

  recordStageOutput(
    nodeId: string,
    result: PreparedStageResult,
    artifact: ArtifactCommitResult
  ): Promise<void> {
    return this.writer.recordStageOutput(nodeId, result, artifact)
  }

  private async updateNodePayload(
    nodeId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    await withTransaction(this.db, async (transaction) => {
      const [node] = await transaction
        .select({ data: canvasNodes.data })
        .from(canvasNodes)
        .where(
          and(
            eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
            eq(canvasNodes.id, nodeId)
          )
        )
        .limit(1)
        .for('update')
      if (!node) throw new Error(`节点不存在：${nodeId}`)
      await transaction
        .update(canvasNodes)
        .set({
          data: patchNodePayload(node.data, patch),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
            eq(canvasNodes.id, nodeId)
          )
        )
    })
  }
}

function readResumeSessionKey(data: unknown): string | undefined {
  const value = readNodePayload(data).directorSessionKey
  return value === undefined
    ? undefined
    : directorStorageKeySchema.parse(value)
}
