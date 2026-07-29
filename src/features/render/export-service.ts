import 'server-only'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ResolutionPreset } from '@/features/canvas'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import { concatExport } from './concat'
import { isDegradable } from './export-degraded'
import { buildSubtitleAss } from './export-subtitles'
import { runShotQaChecks } from './qa-check'
import {
  RenderRepository,
  type ExportPlanOptions,
  type FinalArtifactInput,
  type FinalArtifactRecord,
  type RenderExportPlan,
} from './repository'

export type ExportProjectResult =
  | {
      ok: false
      incompleteNodeIds: string[]
      blockingIssues?: RenderExportPlan['blockingIssues']
    }
  | { ok: true; artifactId: string; outputKey: string; contentHash: string }

interface ExportRepository {
  getExportPlan(projectId: string): Promise<RenderExportPlan>
  registerFinalArtifact(input: FinalArtifactInput): Promise<string>
}

interface ExportDependencies {
  repository?: ExportRepository
  storage?: StorageAdapter
  concat?: typeof concatExport
}

interface ExportReadinessRepository {
  getExportPlan(
    projectId: string,
    options?: ExportPlanOptions
  ): Promise<RenderExportPlan>
  findLatestFinalArtifact(projectId: string): Promise<FinalArtifactRecord | null>
  findDegradedExport(
    projectId: string
  ): Promise<{ placeholderLanes: string[]; waivedQaLanes: string[] } | null>
}

export async function exportProject(
  projectId: string,
  dependencies: ExportDependencies = {}
): Promise<ExportProjectResult> {
  if (!dependencies.repository) {
    await assertProjectWorkflowSupported(projectId)
  }
  const repository = dependencies.repository ?? new RenderRepository()
  const storage = dependencies.storage ?? defaultStorage
  const concat = dependencies.concat ?? concatExport
  const exportPlan = await repository.getExportPlan(projectId)
  if (exportPlan.incompleteNodeIds.length > 0) {
    return incomplete(exportPlan.incompleteNodeIds)
  }
  if (exportPlan.blockingIssues.length > 0 || !exportPlan.mediaAssemblyPlan) {
    return {
      ok: false,
      incompleteNodeIds: [],
      blockingIssues: exportPlan.blockingIssues,
    }
  }
  const assembly = exportPlan.mediaAssemblyPlan
  const subtitleAss = await buildSubtitleAss(assembly, storage)
  const workDirectory = await storage.tempDir('cvc-export-')
  try {
    const temporaryOutput = path.join(workDirectory, 'final.mp4')
    await concat(
      assembly,
      {
        videoPaths: assembly.shots.map((shot) =>
          storage.localPath(shot.video.storageKey)
        ),
        narrationPaths: assembly.shots.map((shot) =>
          storage.localPath(shot.narration.artifact.storageKey)
        ),
        musicPath: assembly.musicKey
          ? storage.localPath(assembly.musicKey)
          : null,
      },
      subtitleAss,
      temporaryOutput
    )
    const bytes = await storage.readLocalFile(temporaryOutput)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const outputKey = await storage.put(
      `exports/${projectId}/final-${contentHash}.mp4`,
      bytes
    )
    try {
      const artifactId = await repository.registerFinalArtifact({
        projectId,
        outputKey,
        contentHash,
        sizeBytes: bytes.byteLength,
      })
      return { ok: true, artifactId, outputKey, contentHash }
    } catch (error) {
      await storage.delete(outputKey)
      throw error
    }
  } finally {
    await storage.removeTempDir(workDirectory)
  }
}

export async function getExportReadiness(
  projectId: string,
  repository: ExportReadinessRepository = new RenderRepository()
): Promise<{
  ready: boolean
  incompleteNodeIds: string[]
  shotCount: number
  shotQa: Record<string, boolean | null>
  /** 当前被人工豁免、未经验收的分镜。 */
  waivedQaLanes: string[]
  resolutionPreset: ResolutionPreset
  finalArtifactId: string | null
  blockingIssues: RenderExportPlan['blockingIssues']
  media: RenderExportPlan['media']
  /** 当前缺渲染产物、可占位出片的 lane。 */
  placeholderCandidateLanes: string[]
  /** 降级导出是否可行（无项目级完整性阻塞）。 */
  degradedReady: boolean
  /** 最新成片若为降级产物，列出其占位镜头。 */
  degradedExport: { placeholderLanes: string[]; waivedQaLanes: string[] } | null
  artifactDelivery:
    | 'none'
    | 'legacy-silent-v1'
    | 'narration-hard-subtitle-v2'
}> {
  const plan = await repository.getExportPlan(projectId)
  const finalArtifact = await repository.findLatestFinalArtifact(projectId)
  const ready =
    plan.incompleteNodeIds.length === 0 &&
    plan.blockingIssues.length === 0 &&
    plan.mediaAssemblyPlan !== null
  let placeholderCandidateLanes: string[] = []
  let degradedReady = false
  if (!ready) {
    const probe = await repository.getExportPlan(projectId, { degraded: true })
    placeholderCandidateLanes = probe.placeholderCandidates
      .map((candidate) => candidate.laneKey)
      .sort()
    degradedReady = isDegradable(probe)
  }
  return {
    ready,
    incompleteNodeIds: plan.incompleteNodeIds,
    shotCount: plan.shots.length,
    shotQa: plan.shotQa,
    waivedQaLanes: plan.waivedQaLanes,
    resolutionPreset: plan.resolutionPreset,
    finalArtifactId: finalArtifact?.artifactId ?? null,
    blockingIssues: plan.blockingIssues,
    media: plan.media,
    placeholderCandidateLanes,
    degradedReady,
    degradedExport: await repository.findDegradedExport(projectId),
    artifactDelivery: finalDelivery(finalArtifact),
  }
}

/** 幂等触发分镜 Final QA 检测并写回 shot-qa 节点。 */
export async function ensureShotQaChecked(projectId: string): Promise<void> {
  await assertProjectWorkflowSupported(projectId)
  await runShotQaChecks(projectId)
}

function incomplete(nodeIds: string[]): ExportProjectResult {
  return { ok: false, incompleteNodeIds: [...new Set(nodeIds)].sort() }
}

function finalDelivery(
  artifact: FinalArtifactRecord | null
): 'none' | 'legacy-silent-v1' | 'narration-hard-subtitle-v2' {
  if (!artifact) return 'none'
  return artifact.schemaVersion === 'cvc.final-video/v2'
    ? 'narration-hard-subtitle-v2'
    : 'legacy-silent-v1'
}
