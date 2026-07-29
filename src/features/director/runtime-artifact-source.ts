import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { type Db } from '@/lib/db/client'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import {
  loadFinalExportDelivery as loadFinalExportDeliveryRecord,
  type FinalExportDelivery,
} from './final-export-artifact-source'
import { readLaneKey } from './runtime-node-data'
import {
  audioAllocationSchema,
  audioManifestSchema,
  ingestStageResultSchema,
  type AudioAllocation,
  type AudioManifest,
  type ScriptUnit,
} from './schemas/ingest'
import {
  directorShotPlanSchema,
  type DirectorShot,
  type DirectorShotPlan,
} from './schemas/director-shot-plan'
import {
  resolveVisualTheme,
  type VisualTheme,
} from './prompts/visual-theme'

const directArtifactSchema = z
  .object({
    masterPlan: z.string().min(1),
    styleBible: z.string().min(1),
  })
  .strict()

const ingestAudioSchema = z.object({
  audioManifest: audioManifestSchema,
  audioAllocation: audioAllocationSchema,
})

interface NodeLane {
  id: string
  laneKey: string | null
  status: string
}

export class DirectorArtifactSource {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageAdapter
  ) {}

  async loadIngestArtifact(projectId: string): Promise<{
    scriptUnits: ScriptUnit[]
  }> {
    const nodeId = await this.findNodeId(projectId, 'script-import')
    const raw = await this.loadArtifactJson(projectId, nodeId, 'director-ingest')
    const parsed = z.object({ scriptUnits: z.unknown() }).parse(raw)
    return ingestStageResultSchema.parse({ scriptUnits: parsed.scriptUnits })
  }

  /**
   * 读取音频时序合同。
   *
   * 配音是异步媒体链：INGEST 成功后才排队合成，`director-ingest-audio` 因此可能
   * 尚未存在（历史项目把同样的字段写在 `director-ingest` 里，需要继续兼容）。
   * 两处都拿不到时必须抛出**明确的媒体未就绪**错误，而不是把只含 scriptUnits 的
   * 文本产物丢给音频 schema——那会让 FABRICATE 显示成 `audioManifest` 合同错误，
   * 完全指错方向（真实事故）。
   */
  async loadIngestAudioArtifact(projectId: string): Promise<{
    audioManifest: AudioManifest
    audioAllocation: AudioAllocation
  }> {
    const nodeId = await this.findNodeId(projectId, 'script-import')
    const kind = (await this.resolveLatestArtifactKey(
      projectId,
      nodeId,
      'director-ingest-audio'
    ))
      ? 'director-ingest-audio'
      : 'director-ingest'
    const parsed = ingestAudioSchema.safeParse(
      await this.loadArtifactJson(projectId, nodeId, kind)
    )
    if (!parsed.success) {
      throw new Error(
        `配音媒体尚未就绪：${kind} 产物不含可用的 audioManifest / audioAllocation。请先完成或重试 INGEST 的配音生成，再执行依赖音频时序的阶段。`
      )
    }
    return parsed.data
  }

  async loadDirectArtifact(projectId: string) {
    const nodeId = await this.findNodeId(projectId, 'shot-split')
    return directArtifactSchema.parse(
      await this.loadArtifactJson(projectId, nodeId, 'director-direct')
    )
  }

  /** 从 script-import.payload.visualTheme 读取色调；缺失或非法回落 dark。 */
  async loadVisualTheme(projectId: string): Promise<VisualTheme> {
    const [row] = await this.db
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.type, 'script-import')
        )
      )
      .limit(1)
    if (!row) return resolveVisualTheme(undefined)
    const payload = z
      .object({
        schemaVersion: z.number(),
        payload: z.record(z.string(), z.unknown()),
      })
      .safeParse(row.data)
    if (!payload.success) return resolveVisualTheme(undefined)
    return resolveVisualTheme(payload.data.payload.visualTheme)
  }

  async loadShotSpecArtifact(
    projectId: string,
    laneKey: string
  ): Promise<DirectorShotPlan> {
    const nodeId = await this.findNodeId(projectId, 'shot-script', laneKey)
    const raw = await this.loadArtifactJson(
      projectId,
      nodeId,
      'director-shot-spec'
    )
    return directorShotPlanSchema.parse(raw)
  }

  async loadAllShotSpecs(projectId: string): Promise<DirectorShotPlan> {
    const nodes = await this.findNodeIds(projectId, 'shot-script')
    if (nodes.length === 0) throw new Error('项目缺少 shot-script 节点')
    const shots: DirectorShot[] = []
    for (const node of nodes.sort(compareLane)) {
      if (!node.laneKey) continue
      const plan = directorShotPlanSchema.parse(
        await this.loadArtifactJson(projectId, node.id, 'director-shot-spec')
      )
      const shot = plan.shots.find((item) => item.id === node.laneKey)
      if (!shot) throw new Error(`shot plan 中找不到 ${node.laneKey}`)
      shots.push(shot)
    }
    if (shots.length === 0) throw new Error('项目缺少可聚合的分镜合同')
    return { schemaVersion: 1, shots }
  }

  async loadRenderedArtifactKey(
    projectId: string,
    laneKey: string
  ): Promise<string> {
    const nodeId = await this.findNodeId(projectId, 'shot-codegen', laneKey)
    const key = await this.resolveLatestArtifactKey(
      projectId,
      nodeId,
      'render-mp4'
    )
    if (!key) throw new Error(`找不到 render-mp4 产物：${laneKey}`)
    return key
  }

  async loadRenderedArtifactInventory(
    projectId: string
  ): Promise<{
    rendered: Array<{ laneKey: string; storageKey: string }>
    skippedLanes: string[]
  }> {
    const nodes = await this.findNodeIds(projectId, 'shot-codegen')
    const lanes = nodes.filter(
      (node): node is NodeLane & { laneKey: string } => node.laneKey !== null
    )
    if (lanes.length === 0) throw new Error('项目缺少 shot-codegen 分镜渲染节点')
    const rows = await this.db
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
          inArray(
            artifacts.aggregateId,
            lanes.map(({ id }) => id)
          ),
          eq(artifacts.kind, 'render-mp4')
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.id))
    const latest = new Map<string, string>()
    for (const row of rows) {
      if (!latest.has(row.nodeId)) latest.set(row.nodeId, row.storageKey)
    }
    const rendered: Array<{ laneKey: string; storageKey: string }> = []
    const skippedLanes: string[] = []
    for (const { id, laneKey, status } of lanes.sort(compareLane)) {
      if (status === 'skipped') {
        skippedLanes.push(laneKey)
        continue
      }
      const storageKey = latest.get(id)
      if (!storageKey) throw new Error(`找不到 render-mp4 产物：${laneKey}`)
      rendered.push({ laneKey, storageKey })
    }
    return { rendered, skippedLanes }
  }

  async loadAllRenderedArtifactKeys(
    projectId: string
  ): Promise<Array<{ laneKey: string; storageKey: string }>> {
    const inventory = await this.loadRenderedArtifactInventory(projectId)
    if (inventory.skippedLanes.length > 0) {
      throw new Error(
        `分镜已跳过渲染，只能进入降级合成：${inventory.skippedLanes.join('、')}`
      )
    }
    return inventory.rendered
  }

  async loadFinalExportArtifact(projectId: string): Promise<string> {
    return (await this.loadFinalExportDelivery(projectId)).storageKey
  }

  async loadFinalExportDelivery(projectId: string): Promise<FinalExportDelivery> {
    return loadFinalExportDeliveryRecord(this.db, this.storage, projectId)
  }

  async loadShotQaFindings(projectId: string): Promise<string[]> {
    const nodes = (await this.findNodeIds(projectId, 'shot-qa')).sort(compareLane)
    const findings: string[] = []
    for (const node of nodes) {
      const key = await this.resolveLatestArtifactKey(
        projectId,
        node.id,
        'director-finalize'
      )
      if (key) findings.push((await this.storage.get(key)).toString('utf-8'))
    }
    return findings
  }

  private async findNodeId(
    projectId: string,
    type: string,
    laneKey?: string
  ): Promise<string> {
    const nodes = await this.findNodeIds(projectId, type)
    const node = laneKey
      ? nodes.find((candidate) => candidate.laneKey === laneKey)
      : nodes[0]
    if (!node) throw new Error(`找不到 ${type}${laneKey ? `(${laneKey})` : ''} 节点`)
    return node.id
  }

  private async findNodeIds(
    projectId: string,
    type: string
  ): Promise<NodeLane[]> {
    const rows = await this.db
      .select({
        id: canvasNodes.id,
        data: canvasNodes.data,
        status: canvasNodes.status,
      })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, currentWorkspaceId()),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.type, type)
        )
      )
    return rows.map((row) => ({
      id: row.id,
      laneKey: readLaneKey(row.data),
      status: row.status,
    }))
  }

  private async resolveLatestArtifactKey(
    projectId: string,
    nodeId: string,
    kind: string
  ): Promise<string | undefined> {
    const [artifact] = await this.db
      .select({ storageKey: artifacts.storageKey })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, currentWorkspaceId()),
          eq(artifacts.projectId, projectId),
          eq(artifacts.aggregateType, 'node'),
          eq(artifacts.aggregateId, nodeId),
          eq(artifacts.kind, kind)
        )
      )
      .orderBy(desc(artifacts.version), desc(artifacts.id))
      .limit(1)
    return artifact?.storageKey
  }

  private async loadArtifactJson(
    projectId: string,
    nodeId: string,
    kind: string
  ): Promise<unknown> {
    const key = await this.resolveLatestArtifactKey(projectId, nodeId, kind)
    if (!key) throw new Error(`找不到 ${kind} 产物：${nodeId}`)
    try {
      return JSON.parse((await this.storage.get(key)).toString('utf-8')) as unknown
    } catch {
      throw new Error(`${kind} 产物不是合法 JSON`)
    }
  }
}

function compareLane(left: NodeLane, right: NodeLane): number {
  return (left.laneKey ?? '').localeCompare(right.laneKey ?? '')
}
