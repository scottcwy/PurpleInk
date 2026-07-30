import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  resolutionForPreset,
  resolveExportSettings,
  type ResolutionPreset,
  type SubtitleDeliveryMode,
} from '@/features/canvas'
import {
  deliveryForSubtitles,
  type FinalVideoDelivery,
} from './final-video-delivery'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { artifacts, canvasNodes, projects } from '@/lib/db/schema/index'
import { withTransaction } from '@/lib/db/transaction'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import {
  loadMediaAssembly,
  type LoadedMediaAssembly,
  type MediaTimeline,
} from './media-assembly-loader'
import type {
  ArtifactRef,
  ExportBlockingIssue,
  MediaAssemblyPlan,
  PlaceholderCandidate,
} from './media-assembly'
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
  /** 本次交付的字幕形态，来自项目导出设置。 */
  subtitles: SubtitleDeliveryMode
  soundEffects?: import('@purpleink/procedural-sfx').ProceduralSfxMode
  shotQa: Record<string, boolean | null>
  /** 人工豁免、未经验收的分镜；不等于 QA 通过。 */
  waivedQaLanes: string[]
  mediaAssemblyPlan: MediaAssemblyPlan | null
  blockingIssues: ExportBlockingIssue[]
  /** 降级导出待占位的 lane（正常模式恒空）。 */
  placeholderCandidates: PlaceholderCandidate[]
  /** 实际使用了占位视频的 lane（正常模式恒空）。 */
  placeholderLaneKeys: string[]
  /** 时间轴帧率（生成占位片段用）；ingest 合同缺失时 null。 */
  fps: number | null
  /** 时间轴真值（来自 INGEST 分配合同），与产物就绪无关；缺合同时 null。 */
  timeline: MediaTimeline | null
  media: {
    narrationReadyCount: number
    /** 本次交付不含字幕时为 null（未测量），不得回落成 requiredShotCount。 */
    subtitleReadyCount: number | null
    requiredShotCount: number
    delivery: FinalVideoDelivery
  }
}

/** 降级导出：允许缺产物的 lane 用预生成的占位片段顶替出片。 */
export interface ExportPlanOptions {
  degraded?: boolean
  placeholderVideos?: ReadonlyMap<string, ArtifactRef>
  placeholderNarrations?: ReadonlyMap<string, ArtifactRef>
}

export interface ShotQaTarget {
  codegenNodeId: string
  qaNodeId: string
  laneKey: string
}

/** Render 持久化端口；集中处理画布顺序、QA 投影与 artifact 指针。 */
export class RenderRepository extends RenderArtifactRepository {
  constructor(
    suppliedDb?: ConstructorParameters<typeof RenderArtifactRepository>[0],
    private readonly suppliedStorage: StorageAdapter = defaultStorage
  ) {
    super(suppliedDb)
  }
  async getExportPlan(
    projectId: string,
    options: ExportPlanOptions = {}
  ): Promise<RenderExportPlan> {
    const database = await this.database()
    const [project] = await database
      .select({ exportSettings: projects.exportSettings })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, currentWorkspaceId()),
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
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId)
        )
      )
    const allNodes = rows.map((row) => ({
      ...row,
      laneKey: laneKeyOf(row.data),
      payload: readPayload(row.data),
    }))
    const nodes = allNodes.flatMap((row) =>
      row.laneKey ? [{ ...row, laneKey: row.laneKey }] : []
    )
    const renderArtifacts = await database
      .select({
        nodeId: artifacts.aggregateId,
        storageKey: artifacts.storageKey,
      })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
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
    const waivedQaLanes = nodes
      .filter(
        (node) =>
          node.type === 'shot-qa' &&
          legacyNodeStatus(node.status) === 'skipped'
      )
      .map((node) => node.laneKey)
      .sort()
    const media = await loadMediaAssembly({
      database,
      storage: this.suppliedStorage,
      projectId,
      nodes: allNodes.map((node) => ({
        nodeId: node.id,
        type: node.type,
        status: legacyNodeStatus(node.status),
        laneKey: node.laneKey,
      })),
      targetResolution: resolutionForPreset(settings.resolutionPreset),
      musicKey: await this.latestMusicKey(projectId),
      subtitles: settings.subtitles,
      soundEffects: settings.soundEffects,
      ...(options.degraded ? { degraded: true } : {}),
      ...(options.placeholderVideos
        ? { placeholderVideos: options.placeholderVideos }
        : {}),
      ...(options.placeholderNarrations
        ? { placeholderNarrations: options.placeholderNarrations }
        : {}),
    })
    return {
      incompleteNodeIds: [...incomplete].sort(),
      shots,
      musicKey: media.plan?.musicKey ?? null,
      targetResolution: resolutionForPreset(settings.resolutionPreset),
      resolutionPreset: settings.resolutionPreset,
      subtitles: settings.subtitles,
      soundEffects: settings.soundEffects,
      shotQa,
      waivedQaLanes,
      mediaAssemblyPlan: media.plan,
      blockingIssues: media.blockingIssues,
      placeholderCandidates: media.placeholderCandidates,
      placeholderLaneKeys: media.placeholderLaneKeys,
      fps: media.fps,
      timeline: media.timeline,
      media: mediaReadiness(media, settings.subtitles),
    }
  }

  /**
   * 最新成片若为降级产物则返回其占位镜头清单，否则 null。
   * 以占位清单里的 `finalContentHash` 与最新 final-mp4 哈希严格比对，
   * 跨次导出不会误报（修复后的完整导出无清单 → 最新 final 哈希不匹配 → null）。
   */
  async findDegradedExport(
    projectId: string
  ): Promise<{ placeholderLanes: string[]; waivedQaLanes: string[] } | null> {
    const final = await this.findLatestFinalArtifact(projectId)
    if (!final) return null
    const database = await this.database()
    const [row] = await database
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'project'),
          eq(artifacts.aggregateId, projectId),
          eq(artifacts.kind, 'final-mp4-degraded-manifest'),
          eq(artifacts.attemptId, final.attemptId)
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
      .limit(1)
    if (!row) return null
    try {
      const parsed = readObject(
        JSON.parse(
          (await this.suppliedStorage.get(row.storageKey)).toString('utf-8')
        ) as unknown
      )
      const lanes = parsed.placeholderLanes
      const waived = parsed.waivedQaLanes
      if (
        parsed.finalContentHash === final.contentHash &&
        Array.isArray(lanes) &&
        lanes.every((lane): lane is string => typeof lane === 'string') &&
        (waived === undefined ||
          (Array.isArray(waived) &&
            waived.every((lane): lane is string => typeof lane === 'string')))
      ) {
        return {
          placeholderLanes: lanes,
          waivedQaLanes: Array.isArray(waived) ? waived : [],
        }
      }
    } catch {
      // 清单不可读时保守处理：视为非降级，不阻断 readiness。
    }
    return null
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
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
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
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
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

function mediaReadiness(
  media: LoadedMediaAssembly,
  subtitles: SubtitleDeliveryMode
): RenderExportPlan['media'] {
  return {
    narrationReadyCount: media.narrationReadyCount,
    subtitleReadyCount: media.subtitleReadyCount,
    requiredShotCount: media.requiredShotCount,
    delivery: deliveryForSubtitles(subtitles),
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
