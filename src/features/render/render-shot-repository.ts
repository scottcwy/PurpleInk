import 'server-only'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb, type Db } from '@/lib/db/client'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import {
  laneKeyOf,
  legacyNodeStatus,
  readPayload,
  withoutPayloadKeys,
} from './persistence'
import type {
  RenderAdmissionContext,
  RenderEnqueueContext,
  RenderJob,
  ThumbnailContext,
} from './types'
import { classifyWorkflowError } from '@/features/canvas/workflow-error'

const renderSpecSchema = z
  .object({
    fps: z.number().positive(),
    durationInFrames: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    seed: z.number().int().optional(),
  })
  .strict()

// 'skipped' 在列：已跳过的 shot-codegen 允许通过 intent=execute 重新入队恢复（见 routing.md 跳过合同）。
const ENQUEUEABLE_STATUSES = new Set(['idle', 'failed', 'stale', 'skipped'])
type RenderContextMode = 'running' | 'completed'
type RenderStatusMode = RenderContextMode | 'enqueueable'

/** Demo render-shot 的运行上下文、source pointer 与失败投影。 */
export class RenderShotRepository {
  constructor(private readonly suppliedDb?: Db) {}

  protected database(): Promise<Db> {
    return this.suppliedDb ? Promise.resolve(this.suppliedDb) : getDb()
  }

  /**
   * 入队校验用的最小上下文，不解析 `renderSpec`（首次入队时该字段不存在，见类型注释）。
   * `job` 只在 `director-fabricate` 产物已存在时（重跑场景）才非空，用于入队前预检。
   */
  async loadRenderAdmissionContext(
    projectId: string,
    nodeId: string
  ): Promise<RenderAdmissionContext> {
    const node = await this.getRenderNode(projectId, nodeId)
    assertRenderStatus(legacyNodeStatus(node.status), 'enqueueable')
    const enqueue: RenderEnqueueContext = {
      projectId,
      nodeId,
      shotId: node.laneKey,
    }
    const htmlKey = await this.findFabricateArtifact(projectId, nodeId)
    if (htmlKey === null) return { enqueue, job: null }
    const spec = parseRenderSpec(node.data)
    return {
      enqueue,
      job: {
        projectId,
        nodeId,
        shotId: node.laneKey,
        htmlKey,
        frames: {
          fps: spec.fps,
          durationInFrames: spec.durationInFrames,
          width: spec.width,
          height: spec.height,
        },
        ...(spec.seed === undefined ? {} : { seed: spec.seed }),
      },
    }
  }

  /** 幂等门槛：已存在 `director-fabricate` 产物时，render handler 不应重新生成 HTML。 */
  async hasFabricateArtifact(projectId: string, nodeId: string): Promise<boolean> {
    return (await this.findFabricateArtifact(projectId, nodeId)) !== null
  }

  /** runtime admission 证明 source 无效后只拒绝本次使用的 draft。 */
  async rejectFabricateArtifact(
    projectId: string,
    nodeId: string,
    sourceKey: string,
  ): Promise<void> {
    const database = await this.database()
    await database.transaction(async (transaction) => {
      await transaction
        .update(artifacts)
        .set({ lifecycle: 'rejected', updatedAt: sql`now()` })
        .where(
          and(
            eq(artifacts.workspaceId, currentWorkspaceId()),
            eq(artifacts.projectId, projectId),
            eq(artifacts.aggregateType, 'node'),
            eq(artifacts.aggregateId, nodeId),
            eq(artifacts.kind, 'director-fabricate'),
            eq(artifacts.storageKey, sourceKey),
            eq(artifacts.lifecycle, 'draft'),
          ),
        )
    })
  }

  loadRenderContext(projectId: string, nodeId: string): Promise<RenderJob> {
    return this.buildRenderJob(projectId, nodeId, 'running')
  }

  async recordRenderError(nodeId: string, error: unknown): Promise<void> {
    return this.recordErrorProjection(nodeId, {
      renderError: classifyWorkflowError(error, { stage: 'RENDER' }),
      directorError: undefined,
    })
  }

  async recordStageError(
    nodeId: string,
    stage: 'FABRICATE',
    error: unknown
  ): Promise<void> {
    return this.recordErrorProjection(nodeId, {
      directorError: classifyWorkflowError(error, { stage }),
      renderError: undefined,
    })
  }

  async recordOutputHash(nodeId: string, contentHash: string): Promise<void> {
    const database = await this.database()
    await database.transaction(async (transaction) => {
      const [node] = await transaction
        .select({ data: canvasNodes.data })
        .from(canvasNodes)
        .where(
          and(
            eq(canvasNodes.workspaceId, currentWorkspaceId()),
            eq(canvasNodes.id, nodeId)
          )
        )
        .limit(1)
        .for('update')
      if (!node) throw new Error(`节点不存在：${nodeId}`)
      await transaction
        .update(canvasNodes)
        .set({
          data: {
            schemaVersion: 1,
            payload: {
              ...readPayload(node.data),
              outputContentHash: contentHash,
            },
          },
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(canvasNodes.workspaceId, currentWorkspaceId()),
            eq(canvasNodes.id, nodeId)
          )
        )
    })
  }

  private async recordErrorProjection(
    nodeId: string,
    projection: {
      directorError?: unknown
      renderError?: unknown
    }
  ): Promise<void> {
    const database = await this.database()
    await database.transaction(async (transaction) => {
      const [node] = await transaction
        .select({ data: canvasNodes.data })
        .from(canvasNodes)
        .where(
          and(
            eq(canvasNodes.workspaceId, currentWorkspaceId()),
            eq(canvasNodes.id, nodeId)
          )
        )
        .limit(1)
        .for('update')
      if (!node) throw new Error(`节点不存在：${nodeId}`)
      await transaction
        .update(canvasNodes)
        .set({
          data: {
            schemaVersion: 1,
            payload: {
              ...withoutPayloadKeys(readPayload(node.data), [
                'directorError',
                'renderError',
              ]),
              ...projection,
            },
          },
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(canvasNodes.workspaceId, currentWorkspaceId()),
            eq(canvasNodes.id, nodeId)
          )
        )
    })
  }

  async loadCompletedThumbnailContext(
    projectId: string,
    nodeId: string
  ): Promise<ThumbnailContext> {
    const job = await this.buildRenderJob(projectId, nodeId, 'completed')
    return {
      projectId,
      nodeId,
      htmlKey: job.htmlKey,
      frames: job.frames,
    }
  }

  private async buildRenderJob(
    projectId: string,
    nodeId: string,
    mode: RenderContextMode
  ): Promise<RenderJob> {
    const node = await this.getRenderNode(projectId, nodeId)
    assertRenderStatus(legacyNodeStatus(node.status), mode)
    const spec = parseRenderSpec(node.data)
    return {
      projectId,
      nodeId,
      shotId: node.laneKey,
      htmlKey: await this.requireFabricateArtifact(projectId, nodeId),
      frames: {
        fps: spec.fps,
        durationInFrames: spec.durationInFrames,
        width: spec.width,
        height: spec.height,
      },
      ...(spec.seed === undefined ? {} : { seed: spec.seed }),
    }
  }

  private async getRenderNode(projectId: string, nodeId: string) {
    const database = await this.database()
    const [node] = await database
      .select({
        id: canvasNodes.id,
        type: canvasNodes.type,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.id, nodeId),
          eq(canvasNodes.projectId, projectId)
        )
      )
      .limit(1)
    if (!node) throw new Error(`项目内不存在节点：${nodeId}`)
    const laneKey = laneKeyOf(node.data)
    if (node.type !== 'shot-codegen' || !laneKey) {
      throw new Error(`节点不是可渲染的 shot-codegen：${nodeId}`)
    }
    return { ...node, laneKey }
  }

  private async requireFabricateArtifact(
    projectId: string,
    nodeId: string
  ): Promise<string> {
    const storageKey = await this.findFabricateArtifact(projectId, nodeId)
    if (storageKey === null) {
      throw new Error(`节点缺少 director-fabricate 产物：${nodeId}`)
    }
    return storageKey
  }

  private async findFabricateArtifact(
    projectId: string,
    nodeId: string
  ): Promise<string | null> {
    const database = await this.database()
    const [artifact] = await database
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.aggregateId, nodeId),
          eq(artifacts.kind, 'director-fabricate'),
          ne(artifacts.lifecycle, 'rejected'),
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    return artifact?.storageKey ?? null
  }
}

function parseRenderSpec(data: unknown) {
  const result = renderSpecSchema.safeParse(readPayload(data).renderSpec)
  if (!result.success) {
    throw new Error(`renderSpec 无效：${result.error.message}`)
  }
  return result.data
}

function assertRenderStatus(status: string, mode: RenderStatusMode): void {
  if (mode === 'enqueueable') {
    if (ENQUEUEABLE_STATUSES.has(status)) return
    throw new Error(`渲染节点当前不可入队：${status}`)
  }
  if (mode === 'running' && status !== 'running') {
    throw new Error(`渲染节点必须处于 running：${status}`)
  }
  if (mode === 'completed' && status !== 'success') {
    throw new Error(`该分镜尚未渲染成功，无法生成缩略图：${status}`)
  }
}
