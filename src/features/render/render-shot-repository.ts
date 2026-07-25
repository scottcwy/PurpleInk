import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import { laneKeyOf, legacyNodeStatus, readPayload } from './persistence'
import type { RenderJob, ThumbnailContext } from './types'

const renderSpecSchema = z
  .object({
    fps: z.number().positive(),
    durationInFrames: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    seed: z.number().int().optional(),
  })
  .strict()

const ENQUEUEABLE_STATUSES = new Set(['idle', 'failed', 'stale'])
type RenderContextMode = 'enqueueable' | 'running' | 'completed'

/** Demo render-shot 的运行上下文、source pointer 与失败投影。 */
export class RenderShotRepository {
  constructor(private readonly suppliedDb?: Db) {}

  protected database(): Promise<Db> {
    return this.suppliedDb ? Promise.resolve(this.suppliedDb) : getDb()
  }

  loadRenderAdmissionContext(
    projectId: string,
    nodeId: string
  ): Promise<RenderJob> {
    return this.buildRenderJob(projectId, nodeId, 'enqueueable')
  }

  loadRenderContext(projectId: string, nodeId: string): Promise<RenderJob> {
    return this.buildRenderJob(projectId, nodeId, 'running')
  }

  async recordRenderError(nodeId: string, error: unknown): Promise<void> {
    const database = await this.database()
    await database.transaction(async (transaction) => {
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
          data: {
            schemaVersion: 1,
            payload: {
              ...readPayload(node.data),
              renderError: {
                message: error instanceof Error ? error.message : String(error),
              },
            },
          },
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
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
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
    const database = await this.database()
    const [artifact] = await database
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.aggregateId, nodeId),
          eq(artifacts.kind, 'director-fabricate')
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    if (!artifact) {
      throw new Error(`节点缺少 director-fabricate 产物：${nodeId}`)
    }
    return artifact.storageKey
  }
}

function parseRenderSpec(data: unknown) {
  const result = renderSpecSchema.safeParse(readPayload(data).renderSpec)
  if (!result.success) {
    throw new Error(`renderSpec 无效：${result.error.message}`)
  }
  return result.data
}

function assertRenderStatus(status: string, mode: RenderContextMode): void {
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
