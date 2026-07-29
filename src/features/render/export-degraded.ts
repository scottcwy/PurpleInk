import 'server-only'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import { concatExport } from './concat'
import { buildSubtitleAss } from './export-subtitles'
import type { ArtifactRef, MediaAssemblyPlan } from './media-assembly'
import {
  generatePlaceholderNarration,
  generatePlaceholderVideo,
} from './placeholder-clip'
import type { ExportPlanOptions, RenderExportPlan } from './repository'
import type {
  DegradedManifestInput,
  FinalArtifactInput,
} from './render-artifact-repository'

/**
 * 降级导出编排：把缺渲染/旁白的失败分镜用真实占位片段顶替后出片，让 1/N 失败
 * 不再堵死整片。**只由用户显式触发**（POST body `degraded:true`）；自动推进链不走这里。
 *
 * 诚实性：占位片段是真实 ffmpeg 黑场（字节汇入 final-mp4 哈希），成片占位清单登记为
 * `final-mp4-degraded-manifest` 产物并含 `finalContentHash` 与当次成片精确对应。
 */

export type DegradedExportResult =
  | {
      ok: false
      incompleteNodeIds: string[]
      blockingIssues: RenderExportPlan['blockingIssues']
    }
  | {
      ok: true
      artifactId: string
      outputKey: string
      contentHash: string
      placeholderLanes: string[]
      waivedQaLanes: string[]
    }

interface DegradedPlanRepository {
  getExportPlan(
    projectId: string,
    options?: ExportPlanOptions
  ): Promise<RenderExportPlan>
}

interface DegradedExportRepository extends DegradedPlanRepository {
  registerFinalArtifact(input: FinalArtifactInput): Promise<string>
  registerDegradedManifest(input: DegradedManifestInput): Promise<string>
}

export interface DegradedExportDependencies {
  repository: DegradedExportRepository
  storage?: StorageAdapter
  concat?: typeof concatExport
}

interface DegradedPlan {
  plan: MediaAssemblyPlan | null
  placeholderLanes: string[]
  waivedQaLanes: string[]
  blockingIssues: RenderExportPlan['blockingIssues']
  degradable: boolean
}

/** 项目级完整性问题（`laneKey=null`，如 INGEST 音频合同缺失、帧总数不一致）不可占位。 */
export function isDegradable(plan: RenderExportPlan): boolean {
  return (
    plan.fps !== null &&
    !plan.blockingIssues.some((issue) => issue.laneKey === null)
  )
}

/**
 * 两趟解析：先探测得到待占位候选与 fps/分辨率，为其生成占位片段，再带占位 map
 * 重新装配出可拼接的降级计划。占位片段以确定性 key 幂等复用。
 */
export async function resolveDegradedPlan(
  projectId: string,
  dependencies: { repository: DegradedPlanRepository; storage?: StorageAdapter }
): Promise<DegradedPlan> {
  const storage = dependencies.storage ?? defaultStorage
  const probe = await dependencies.repository.getExportPlan(projectId, {
    degraded: true,
  })
  if (!isDegradable(probe)) {
    return {
      plan: null,
      placeholderLanes: [],
      waivedQaLanes: probe.waivedQaLanes,
      blockingIssues: probe.blockingIssues,
      degradable: false,
    }
  }
  const fps = probe.fps ?? 30
  const { width, height } = probe.targetResolution
  const placeholderVideos = new Map<string, ArtifactRef>()
  const placeholderNarrations = new Map<string, ArtifactRef>()
  for (const candidate of probe.placeholderCandidates) {
    if (candidate.needsVideo) {
      placeholderVideos.set(
        candidate.laneKey,
        await generatePlaceholderVideo(
          {
            projectId,
            laneKey: candidate.laneKey,
            params: { width, height, fps, durationInFrames: candidate.durationInFrames },
          },
          { storage }
        )
      )
    }
    if (candidate.needsNarration) {
      placeholderNarrations.set(
        candidate.laneKey,
        await generatePlaceholderNarration(
          {
            projectId,
            laneKey: candidate.laneKey,
            durationMs: Math.round((candidate.durationInFrames / fps) * 1_000),
          },
          { storage }
        )
      )
    }
  }
  const assembled = await dependencies.repository.getExportPlan(projectId, {
    degraded: true,
    placeholderVideos,
    placeholderNarrations,
  })
  return {
    plan: assembled.mediaAssemblyPlan,
    placeholderLanes: [...assembled.placeholderLaneKeys].sort(),
    waivedQaLanes: [...probe.waivedQaLanes].sort(),
    blockingIssues: assembled.blockingIssues,
    degradable: true,
  }
}

/** 生成占位并拼接出片；提交 final-mp4 后登记降级占位清单。 */
export async function exportDegradedProject(
  projectId: string,
  dependencies: DegradedExportDependencies
): Promise<DegradedExportResult> {
  const storage = dependencies.storage ?? defaultStorage
  const concat = dependencies.concat ?? concatExport
  const degraded = await resolveDegradedPlan(projectId, {
    repository: dependencies.repository,
    storage,
  })
  if (!degraded.degradable || !degraded.plan) {
    return { ok: false, incompleteNodeIds: [], blockingIssues: degraded.blockingIssues }
  }
  const assembly = degraded.plan
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
        musicPath: assembly.musicKey ? storage.localPath(assembly.musicKey) : null,
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
    return commitDegraded(dependencies.repository, storage, {
      projectId,
      outputKey,
      contentHash,
      sizeBytes: bytes.byteLength,
      placeholderLanes: degraded.placeholderLanes,
      waivedQaLanes: degraded.waivedQaLanes,
    })
  } finally {
    await storage.removeTempDir(workDirectory)
  }
}

/** 提交 final-mp4 与占位清单；任一失败都清理已落盘字节，不留孤儿产物指针。 */
async function commitDegraded(
  repository: DegradedExportRepository,
  storage: StorageAdapter,
  input: FinalArtifactInput & {
    placeholderLanes: string[]
    waivedQaLanes: string[]
  }
): Promise<DegradedExportResult> {
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      finalContentHash: input.contentHash,
      placeholderLanes: input.placeholderLanes,
      waivedQaLanes: input.waivedQaLanes,
    }),
    'utf-8'
  )
  const manifestHash = createHash('sha256').update(manifestBytes).digest('hex')
  const manifestKey = await storage.put(
    `exports/${input.projectId}/final-${input.contentHash}.degraded.json`,
    manifestBytes
  )
  try {
    const artifactId = await repository.registerFinalArtifact({
      projectId: input.projectId,
      outputKey: input.outputKey,
      contentHash: input.contentHash,
      sizeBytes: input.sizeBytes,
    })
    await repository.registerDegradedManifest({
      projectId: input.projectId,
      storageKey: manifestKey,
      contentHash: manifestHash,
      sizeBytes: manifestBytes.byteLength,
    })
    return {
      ok: true,
      artifactId,
      outputKey: input.outputKey,
      contentHash: input.contentHash,
      placeholderLanes: input.placeholderLanes,
      waivedQaLanes: input.waivedQaLanes,
    }
  } catch (error) {
    await storage.delete(input.outputKey)
    await storage.delete(manifestKey)
    throw error
  }
}
