import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { LOCAL_WORKSPACE_ID, type Db } from '@/lib/db/client'
import { artifacts, canvasNodes } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import { buildDemoAudioAllocation, buildDemoAudioManifest } from './audio-demo'
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

const directArtifactSchema = z
  .object({
    masterPlan: z.string().min(1),
    styleBible: z.string().min(1),
  })
  .strict()

interface NodeLane {
  id: string
  laneKey: string | null
}

export class DirectorArtifactSource {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageAdapter
  ) {}

  async loadIngestArtifact(projectId: string): Promise<{
    scriptUnits: ScriptUnit[]
    audioManifest: AudioManifest
    audioAllocation: AudioAllocation
  }> {
    const nodeId = await this.findNodeId(projectId, 'script-import')
    const raw = await this.loadArtifactJson(projectId, nodeId, 'director-ingest')
    const parsed = z
      .object({
        scriptUnits: z.unknown(),
        audioManifest: z.unknown().optional(),
        audioAllocation: z.unknown().optional(),
      })
      .parse(raw)
    const scriptUnits = ingestStageResultSchema.parse({
      scriptUnits: parsed.scriptUnits,
    }).scriptUnits
    if (parsed.audioManifest && parsed.audioAllocation) {
      return {
        scriptUnits,
        audioManifest: audioManifestSchema.parse(parsed.audioManifest),
        audioAllocation: audioAllocationSchema.parse(parsed.audioAllocation),
      }
    }
    const audioManifest = buildDemoAudioManifest(scriptUnits)
    return {
      scriptUnits,
      audioManifest,
      audioAllocation: buildDemoAudioAllocation(scriptUnits, audioManifest),
    }
  }

  async loadDirectArtifact(projectId: string) {
    const nodeId = await this.findNodeId(projectId, 'shot-split')
    return directArtifactSchema.parse(
      await this.loadArtifactJson(projectId, nodeId, 'director-direct')
    )
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

  async loadAllRenderedArtifactKeys(
    projectId: string
  ): Promise<Array<{ laneKey: string; storageKey: string }>> {
    const nodes = await this.findNodeIds(projectId, 'shot-codegen')
    const lanes = nodes.filter(
      (node): node is { id: string; laneKey: string } => node.laneKey !== null
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
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
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
    return lanes
      .map(({ id, laneKey }) => {
        const storageKey = latest.get(id)
        if (!storageKey) throw new Error(`找不到 render-mp4 产物：${laneKey}`)
        return { laneKey, storageKey }
      })
      .sort((left, right) => left.laneKey.localeCompare(right.laneKey))
  }

  async loadFinalExportArtifact(projectId: string): Promise<string> {
    const [artifact] = await this.db
      .select({ storageKey: artifacts.storageKey })
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
      .orderBy(desc(artifacts.version), desc(artifacts.id))
      .limit(1)
    if (!artifact) throw new Error('请先完成合成导出：项目尚无 final-mp4 产物')
    return artifact.storageKey
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
      .select({ id: canvasNodes.id, data: canvasNodes.data })
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
          eq(canvasNodes.projectId, projectId),
          eq(canvasNodes.type, type)
        )
      )
    return rows.map((row) => ({ id: row.id, laneKey: readLaneKey(row.data) }))
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
          eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
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
