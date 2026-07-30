import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { SubtitleDeliveryMode } from '@/features/canvas/export-settings'
import {
  audioAllocationSchema,
  audioManifestSchema,
} from '@/features/director/schemas/ingest'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { type Db } from '@/lib/db/client'
import { artifacts } from '@/lib/db/schema/index'
import type { StorageAdapter } from '@/lib/storage'
import { isDirectorIngestSourceNodeType } from '@/features/canvas'
import {
  assembleTrustedMediaPlan,
  type ArtifactRef,
  type ExportBlockingIssue,
  type MediaAssemblyPlan,
  type PlaceholderCandidate,
} from './media-assembly'

interface AssemblyNode {
  nodeId: string
  type: string
  status: string
  laneKey: string | null
}

interface LoadInput {
  database: Db
  storage: StorageAdapter
  projectId: string
  nodes: AssemblyNode[]
  targetResolution: { width: number; height: number }
  musicKey: string | null
  /** 本次交付的字幕形态；`off` 时不读也不校验字幕产物。 */
  subtitles: SubtitleDeliveryMode
  /** 降级导出：允许缺产物的 lane 用占位顶替。 */
  degraded?: boolean
  placeholderVideos?: ReadonlyMap<string, ArtifactRef>
  placeholderNarrations?: ReadonlyMap<string, ArtifactRef>
}

export interface LoadedMediaAssembly {
  plan: MediaAssemblyPlan | null
  blockingIssues: ExportBlockingIssue[]
  narrationReadyCount: number
  /**
   * 就绪字幕数；本次交付不含字幕时为 null（未测量）。
   *
   * 不能在关闭时回落成 requiredShotCount：那条路径根本没有 subtitle 阻塞项，
   * 按阻塞项反推会得出「5/5 就绪」，等于在关着字幕时宣称字幕全部就绪。
   */
  subtitleReadyCount: number | null
  requiredShotCount: number
  /** 降级模式待占位的 lane（正常模式恒空）。 */
  placeholderCandidates: PlaceholderCandidate[]
  /** 实际使用了占位视频的 lane（正常模式恒空）。 */
  placeholderLaneKeys: string[]
  /** 时间轴帧率（用于生成占位片段）；ingest 合同缺失时为 null。 */
  fps: number | null
  /**
   * 时间轴真值：来自 INGEST 音频分配合同，与产物是否就绪无关。
   *
   * 单独投影是因为 `plan` 只在完全就绪时才非空，而导出页在未就绪时同样要按
   * 真实时长画轨道——否则只能退回常量宽度，UI 会暗示错误的时间位置。
   * ingest 合同缺失或无效时为 null，此时页面显示未接线而不是编造刻度。
   */
  timeline: MediaTimeline | null
}

export interface MediaTimeline {
  fps: 24 | 30 | 60
  totalFrames: number
  shots: { laneKey: string; durationInFrames: number }[]
}

const subtitleLineageSchema = z
  .object({
    shotId: z.string().min(1),
    sourceAudioArtifactId: z.string().min(1),
    sourceAudioKey: z.string().min(1),
  })
  .passthrough()

export async function loadMediaAssembly(
  input: LoadInput
): Promise<LoadedMediaAssembly> {
  const rows = await input.database
    .select({
      artifactId: artifacts.id,
      aggregateId: artifacts.aggregateId,
      kind: artifacts.kind,
      storageKey: artifacts.storageKey,
      contentHash: artifacts.contentHash,
      version: artifacts.version,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, currentWorkspaceId()),
        eq(artifacts.projectId, input.projectId),
        eq(artifacts.aggregateType, 'node')
      )
    )
    .orderBy(desc(artifacts.version), desc(artifacts.createdAt))
  const ingestNode = input.nodes.find((node) =>
    isDirectorIngestSourceNodeType(node.type),
  )
  const ingestArtifact = ingestNode
    ? selectIngestAudioArtifact(rows, ingestNode.nodeId)
    : undefined
  if (!ingestArtifact) {
    return blocked(input.nodes, 'artifact-missing', input.subtitles)
  }

  const ingest = await readJsonArtifact(input.storage, ingestArtifact)
  if (ingest.status !== 'ok') {
    return blocked(
      input.nodes,
      ingest.status === 'missing' ? 'artifact-missing' : 'artifact-invalid',
      input.subtitles
    )
  }
  const parsedIngest = z
    .object({
      audioManifest: audioManifestSchema,
      audioAllocation: audioAllocationSchema,
    })
    .passthrough()
    .safeParse(ingest.value)
  if (!parsedIngest.success) {
    return blocked(input.nodes, 'artifact-invalid', input.subtitles)
  }

  // 字幕关闭时整段跳过：既不读字节也不记 subtitle 阻塞项，顺便省掉一轮存储 IO。
  const subtitleTracks: Record<
    string,
    z.infer<typeof subtitleLineageSchema>
  > = {}
  const storageIssues: ExportBlockingIssue[] = []
  const subtitleNodes =
    input.subtitles === 'burn-in'
      ? input.nodes.filter((candidate) => candidate.type === 'shot-subtitle')
      : []
  for (const node of subtitleNodes) {
    const artifact = latest(rows, node.nodeId, 'subtitle-track')
    if (!artifact) continue
    const loaded = await readJsonArtifact(input.storage, artifact)
    if (loaded.status !== 'ok') {
      storageIssues.push({
        laneKey: node.laneKey,
        kind: 'subtitle',
        code:
          loaded.status === 'missing'
            ? 'artifact-missing'
            : 'artifact-invalid',
      })
      continue
    }
    const parsed = subtitleLineageSchema.safeParse(loaded.value)
    if (parsed.success) subtitleTracks[artifact.artifactId] = parsed.data
  }

  const result = assembleTrustedMediaPlan({
    nodes: input.nodes.flatMap((node) =>
      node.laneKey ? [{ ...node, laneKey: node.laneKey }] : []
    ),
    artifacts: rows,
    subtitleTracks,
    audioManifest: parsedIngest.data.audioManifest,
    audioAllocation: parsedIngest.data.audioAllocation,
    targetResolution: input.targetResolution,
    musicKey: input.musicKey,
    subtitles: input.subtitles,
    ...(input.degraded ? { degraded: true } : {}),
    ...(input.placeholderVideos
      ? { placeholderVideos: input.placeholderVideos }
      : {}),
    ...(input.placeholderNarrations
      ? { placeholderNarrations: input.placeholderNarrations }
      : {}),
  })
  const issues = mergeIssues(storageIssues, result.blockingIssues)
  if (result.plan) {
    await validateFiles(input.storage, result.plan, issues)
  }
  const requiredShotCount = parsedIngest.data.audioAllocation.shots.length
  return {
    plan: issues.length === 0 ? result.plan : null,
    blockingIssues: issues,
    narrationReadyCount: readyCount(requiredShotCount, issues, 'narration'),
    subtitleReadyCount:
      input.subtitles === 'burn-in'
        ? readyCount(requiredShotCount, issues, 'subtitle')
        : null,
    requiredShotCount,
    placeholderCandidates: result.placeholderCandidates,
    placeholderLaneKeys: result.placeholderLaneKeys,
    fps: parsedIngest.data.audioAllocation.fps,
    timeline: {
      fps: parsedIngest.data.audioAllocation.fps,
      totalFrames: parsedIngest.data.audioAllocation.totalFrames,
      shots: parsedIngest.data.audioAllocation.shots.map((shot) => ({
        laneKey: shot.id,
        durationInFrames: shot.durationInFrames,
      })),
    },
  }
}

function latest<T extends {
    aggregateId: string
    kind: string
    version: number
  }>(
  rows: T[],
  aggregateId: string,
  kind: string
): T | undefined {
  return rows
    .filter((row) => row.aggregateId === aggregateId && row.kind === kind)
    .sort((left, right) => right.version - left.version)[0]
}

export function selectIngestAudioArtifact<T extends {
    aggregateId: string
    kind: string
    version: number
  }>(
  rows: T[],
  ingestNodeId: string
): T | undefined {
  return (
    latest(rows, ingestNodeId, 'director-ingest-audio') ??
    latest(rows, ingestNodeId, 'director-ingest')
  )
}

async function readJsonArtifact(
  storage: StorageAdapter,
  artifact: { storageKey: string; contentHash: string }
): Promise<
  | { status: 'ok'; value: unknown }
  | { status: 'missing' | 'invalid' }
> {
  if (!(await storage.exists(artifact.storageKey))) {
    return { status: 'missing' }
  }
  try {
    const bytes = await storage.get(artifact.storageKey)
    if (digest(bytes) !== artifact.contentHash) return { status: 'invalid' }
    return {
      status: 'ok',
      value: JSON.parse(bytes.toString('utf-8')) as unknown,
    }
  } catch {
    return { status: 'invalid' }
  }
}

function mergeIssues(
  preferred: ExportBlockingIssue[],
  remaining: ExportBlockingIssue[]
): ExportBlockingIssue[] {
  const result = [...preferred]
  for (const issue of remaining) {
    if (
      !result.some(
        (current) =>
          current.laneKey === issue.laneKey && current.kind === issue.kind
      )
    ) {
      result.push(issue)
    }
  }
  return result
}

async function validateFiles(
  storage: StorageAdapter,
  plan: MediaAssemblyPlan,
  issues: ExportBlockingIssue[]
): Promise<void> {
  for (const shot of plan.shots) {
    await validateRef(storage, shot.laneKey, 'render', shot.video, issues)
    await validateRef(
      storage,
      shot.laneKey,
      'narration',
      shot.narration.artifact,
      issues
    )
    // subtitle=null 有两种成因（关闭字幕交付、降级占位镜头），都无需校验。
    if (shot.subtitle) {
      await validateRef(storage, shot.laneKey, 'subtitle', shot.subtitle, issues)
    }
  }
}

async function validateRef(
  storage: StorageAdapter,
  laneKey: string,
  kind: ExportBlockingIssue['kind'],
  artifact: { storageKey: string; contentHash: string },
  issues: ExportBlockingIssue[]
): Promise<void> {
  if (!(await storage.exists(artifact.storageKey))) {
    issues.push({ laneKey, kind, code: 'artifact-missing' })
    return
  }
  const bytes = await storage.get(artifact.storageKey)
  if (digest(bytes) !== artifact.contentHash) {
    issues.push({ laneKey, kind, code: 'artifact-invalid' })
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function blocked(
  nodes: AssemblyNode[],
  code: ExportBlockingIssue['code'],
  subtitles: SubtitleDeliveryMode
): LoadedMediaAssembly {
  return {
    plan: null,
    blockingIssues: [{ laneKey: null, kind: 'render', code }],
    narrationReadyCount: 0,
    subtitleReadyCount: subtitles === 'burn-in' ? 0 : null,
    requiredShotCount: nodes.filter((node) => node.type === 'shot-codegen').length,
    placeholderCandidates: [],
    placeholderLaneKeys: [],
    fps: null,
    timeline: null,
  }
}

function readyCount(
  total: number,
  issues: ExportBlockingIssue[],
  kind: ExportBlockingIssue['kind']
): number {
  return Math.max(
    0,
    total - new Set(issues.filter((issue) => issue.kind === kind).map((issue) => issue.laneKey)).size
  )
}
