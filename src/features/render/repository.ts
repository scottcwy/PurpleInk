import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  resolutionForPreset,
  resolveExportSettings,
  type ResolutionPreset,
} from '@/features/canvas'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { artifacts, canvasNodes, projects } from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import {
  laneKeyOf,
  legacyNodeStatus,
  readPayload,
  writeNodeProjection,
} from './persistence'
import {
  RenderArtifactRepository,
  type FinalArtifactInput,
  type FinalArtifactRecord,
} from './render-artifact-repository'
import type { ShotQaCheckData, ShotQaVisionData } from './types'

export type { FinalArtifactInput, FinalArtifactRecord }

export interface ExportShot {
  nodeId: string
  laneKey: string
  outputKey: string
}

export interface RenderExportPlan {
  incompleteNodeIds: string[]
  shots: ExportShot[]
  musicKey: string | null
  targetResolution: { width: number; height: number }
  resolutionPreset: ResolutionPreset
  shotQa: Record<string, boolean | null>
}

export interface ShotQaTarget {
  codegenNodeId: string
  qaNodeId: string
  laneKey: string
}

/** Render 持久化端口；集中处理画布顺序、QA 投影与 artifact 指针。 */
export class RenderRepository extends RenderArtifactRepository {
  async getExportPlan(projectId: string): Promise<RenderExportPlan> {
    const database = await this.database()
    const [project] = await database
      .select({ exportSettings: projects.exportSettings })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, LOCAL_WORKSPACE_ID),
          eq(projects.id, projectId)
        )
      )
      .limit(1)
    if (!project) throw new Error(`项目不存在：${projectId}`)
    const settings = resolveExportSettings(
      readObject(project.exportSettings).settings
    )
    const rows = await database
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
          eq(canvasNodes.projectId, projectId)
        )
      )
    const nodes = rows.flatMap((row) => {
      const laneKey = laneKeyOf(row.data)
      return laneKey
        ? [{ ...row, laneKey, payload: readPayload(row.data) }]
        : []
    })
    const renderArtifacts = await database
      .select({
        nodeId: artifacts.aggregateId,
        storageKey: artifacts.storageKey,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.kind, 'render-mp4')
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
    const latestByNode = new Map<string, string>()
    for (const artifact of renderArtifacts) {
      if (!latestByNode.has(artifact.nodeId)) {
        latestByNode.set(artifact.nodeId, artifact.storageKey)
      }
    }
    const incomplete = new Set(
      nodes
        .filter((node) => legacyNodeStatus(node.status) !== 'success')
        .map((node) => node.id)
    )
    const shots = nodes
      .filter((node) => node.type === 'shot-codegen')
      .flatMap((node) => {
        const outputKey = latestByNode.get(node.id)
        if (!outputKey) {
          incomplete.add(node.id)
          return []
        }
        return [{ nodeId: node.id, laneKey: node.laneKey, outputKey }]
      })
      .sort((left, right) => left.laneKey.localeCompare(right.laneKey))
    const shotQa: Record<string, boolean | null> = {}
    for (const node of nodes) {
      if (node.type === 'shot-qa') {
        shotQa[node.laneKey] = qaPassedOf(node.payload)
      }
    }
    return {
      incompleteNodeIds: [...incomplete].sort(),
      shots,
      musicKey: await this.latestMusicKey(projectId),
      targetResolution: resolutionForPreset(settings.resolutionPreset),
      resolutionPreset: settings.resolutionPreset,
      shotQa,
    }
  }

  async getShotQaTargets(projectId: string): Promise<ShotQaTarget[]> {
    const database = await this.database()
    const rows = await database
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
          eq(canvasNodes.projectId, projectId)
        )
      )
    const nodes = rows.flatMap((row) => {
      const laneKey = laneKeyOf(row.data)
      return laneKey ? [{ ...row, laneKey }] : []
    })
    const qaNodeByLane = new Map<string, string>()
    for (const node of nodes) {
      if (node.type === 'shot-qa') qaNodeByLane.set(node.laneKey, node.id)
    }
    return nodes
      .filter(
        (node) =>
          node.type === 'shot-codegen' &&
          legacyNodeStatus(node.status) === 'success'
      )
      .flatMap((node) => {
        const qaNodeId = qaNodeByLane.get(node.laneKey)
        return qaNodeId
          ? [{ codegenNodeId: node.id, qaNodeId, laneKey: node.laneKey }]
          : []
      })
      .sort((left, right) => left.laneKey.localeCompare(right.laneKey))
  }

  async readShotQaCheck(nodeId: string): Promise<ShotQaCheckData | null> {
    const database = await this.database()
    const [node] = await database
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.id, nodeId)
        )
      )
      .limit(1)
    return node
      ? asShotQaCheckData(readPayload(node.data).qaCheck)
      : null
  }

  async writeShotQaCheck(
    nodeId: string,
    qaCheck: ShotQaCheckData
  ): Promise<void> {
    const database = await this.database()
    await withTransaction(database, (transaction) =>
      writeNodeProjection(transaction, nodeId, 'qaCheck', qaCheck)
    )
  }

  async writeShotQaVision(
    nodeId: string,
    qaVision: ShotQaVisionData
  ): Promise<void> {
    const database = await this.database()
    await withTransaction(database, (transaction) =>
      writeNodeProjection(transaction, nodeId, 'qaVision', qaVision)
    )
  }
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function qaPassedOf(data: Record<string, unknown>): boolean | null {
  const qaCheck = readObject(data.qaCheck)
  if (typeof qaCheck.passed !== 'boolean') return null
  const qaVision = readObject(data.qaVision)
  return typeof qaVision.passed === 'boolean'
    ? qaCheck.passed && qaVision.passed
    : qaCheck.passed
}

function asShotQaCheckData(value: unknown): ShotQaCheckData | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as ShotQaCheckData).thumbnailContentHash === 'string' &&
    typeof (value as ShotQaCheckData).passed === 'boolean'
  ) {
    return value as ShotQaCheckData
  }
  return null
}
