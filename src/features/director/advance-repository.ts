import { and, eq, inArray, ne } from 'drizzle-orm'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { type Db } from '@/lib/db/client'
import { canvasEdges, canvasNodes, projects } from '@/lib/db/schema/index'
import { storage } from '@/lib/storage'
import type { CanvasNodeType } from '@/features/canvas'
import type {
  AdvanceCandidate,
  AdvanceRepository,
  PipelineRepository,
} from './advance'
import { DirectorRuntimeRepository } from './runtime-repository'
import { fromPersistedNodeStatus, readNodePayload } from './runtime-node-data'
import type { PipelineStage } from './types'
import { isStale, transitionNodeStatus } from '@/features/canvas/status'
import { DirectorArtifactSource } from './runtime-artifact-source'

export class AdvanceRepositoryImpl
  implements AdvanceRepository, PipelineRepository
{
  private readonly directorRepository: DirectorRuntimeRepository
  private readonly artifactSource: DirectorArtifactSource

  constructor(private readonly db: Db) {
    this.directorRepository = new DirectorRuntimeRepository(db, storage)
    this.artifactSource = new DirectorArtifactSource(db, storage)
  }

  async isAutopilotEnabled(projectId: string): Promise<boolean> {
    const [project] = await this.db
      .select({ autopilot: projects.autopilot })
      .from(projects)
      .where(scope(projects.workspaceId, projects.id, projectId))
      .limit(1)
    return project?.autopilot ?? false
  }

  async setAutopilot(projectId: string, enabled: boolean): Promise<boolean> {
    const [updated] = await this.db
      .update(projects)
      .set({ autopilot: enabled, updatedAt: new Date() })
      .where(scope(projects.workspaceId, projects.id, projectId))
      .returning({ autopilot: projects.autopilot })
    if (!updated) throw new Error(`项目不存在：${projectId}`)
    return updated.autopilot
  }

  async getEntryNode(projectId: string): Promise<AdvanceCandidate> {
    const [node] = await this.db
      .select({
        id: canvasNodes.id,
        type: canvasNodes.type,
        stage: canvasNodes.stage,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.type, 'script-import')
        )
      )
      .limit(1)
    if (!node) throw new Error(`项目缺少 script-import 入口节点：${projectId}`)
    return toAdvanceCandidate(node)
  }

  async listSuccessfulNodeIds(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: canvasNodes.id })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.status, 'succeeded')
        )
      )
    return rows.map(({ id }) => id)
  }

  async listDownstreamCandidates(
    projectId: string,
    completedNodeId: string
  ): Promise<AdvanceCandidate[]> {
    const edges = await this.db
      .select({ target: canvasEdges.target })
      .from(canvasEdges)
      .where(
        and(
          eq(canvasEdges.workspaceId, currentWorkspaceId()),
          eq(canvasEdges.projectId, projectId),
          eq(canvasEdges.source, completedNodeId)
        )
      )
    const targetIds = [...new Set(edges.map(({ target }) => target))]
    if (targetIds.length === 0) return []
    const nodes = await this.db
      .select({
        id: canvasNodes.id,
        type: canvasNodes.type,
        stage: canvasNodes.stage,
        status: canvasNodes.status,
        data: canvasNodes.data,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          inArray(canvasNodes.id, targetIds)
        )
      )
    return nodes.map(toAdvanceCandidate)
  }

  async areAllUpstreamsSuccessful(
    projectId: string,
    nodeId: string
  ): Promise<boolean> {
    const edges = await this.db
      .select({ source: canvasEdges.source })
      .from(canvasEdges)
      .where(
        and(
          eq(canvasEdges.workspaceId, currentWorkspaceId()),
          eq(canvasEdges.projectId, projectId),
          eq(canvasEdges.target, nodeId)
        )
      )
    if (edges.length === 0) return false
    const sourceIds = [...new Set(edges.map(({ source }) => source))]
    const upstreams = await this.db
      .select({ status: canvasNodes.status })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          inArray(canvasNodes.id, sourceIds)
        )
      )
    return (
      upstreams.length === sourceIds.length &&
      upstreams.every(({ status }) => status === 'succeeded')
    )
  }

  async isMediaReady(projectId: string): Promise<boolean> {
    try {
      await this.artifactSource.loadIngestAudioArtifact(projectId)
      return true
    } catch {
      return false
    }
  }

  async isProjectComplete(projectId: string): Promise<boolean> {
    const [unfinished] = await this.db
      .select({ id: canvasNodes.id })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          ne(canvasNodes.status, 'succeeded')
        )
      )
      .limit(1)
    return !unfinished
  }

  isNodeStale(nodeId: string): Promise<boolean> {
    return isStale(nodeId)
  }

  markNodeStale(nodeId: string): Promise<void> {
    return transitionNodeStatus(nodeId, 'stale')
  }

  async recordStageError(
    nodeId: string,
    stage: PipelineStage,
    error: unknown
  ): Promise<void> {
    await this.directorRepository.recordStageError(nodeId, stage, error)
  }
}

function toAdvanceCandidate(node: {
  id: string
  type: string
  stage: string
  status: string
  data: unknown
}): AdvanceCandidate {
  const payload = readNodePayload(node.data)
  const error = payload.directorError ?? payload.renderError
  return {
    id: node.id,
    type: node.type as CanvasNodeType,
    stage: node.stage,
    status: fromPersistedNodeStatus(node.status),
    ...(hasRetryable(error) ? { retryable: error.retryable } : {}),
  }
}

function hasRetryable(value: unknown): value is { retryable: boolean } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).retryable === 'boolean'
  )
}

function scope(
  workspaceColumn: typeof projects.workspaceId,
  idColumn: typeof projects.id,
  projectId: string
) {
  return and(
    eq(workspaceColumn, currentWorkspaceId()),
    eq(idColumn, projectId)
  )
}
