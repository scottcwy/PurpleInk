import 'server-only'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import { concatExport } from './concat'
import { buildSubtitleAss } from './export-subtitles'
import { runShotQaChecks } from './qa-check'
import {
  RenderRepository,
  type RenderExportPlan,
} from './repository'
import type { FinalDeliveryInput } from './render-artifact-repository'
import { storeProceduralSfxManifest } from './procedural-sfx-manifest'
import { finalVideoStorageKey } from './final-output-storage'

export type ExportProjectResult =
  | {
      ok: false
      incompleteNodeIds: string[]
      blockingIssues?: RenderExportPlan['blockingIssues']
    }
  | { ok: true; artifactId: string; outputKey: string; contentHash: string }

interface ExportRepository {
  getExportPlan(projectId: string): Promise<RenderExportPlan>
  registerFinalDelivery(
    input: FinalDeliveryInput
  ): Promise<{
    finalArtifactId: string
    soundEffectsManifestArtifactId: string
    degradedManifestArtifactId: string | null
  }>
}

interface ExportDependencies {
  repository?: ExportRepository
  storage?: StorageAdapter
  concat?: typeof concatExport
}

export async function exportProject(
  projectId: string,
  attemptId: string,
  dependencies: ExportDependencies = {}
): Promise<ExportProjectResult> {
  if (!dependencies.repository) {
    await assertProjectWorkflowSupported(projectId)
  }
  const repository = dependencies.repository ?? new RenderRepository()
  const storage = dependencies.storage ?? defaultStorage
  const concat = dependencies.concat ?? concatExport
  const exportPlan = await exportPhase('plan', () =>
    repository.getExportPlan(projectId)
  )
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
  // 字幕关闭时连 .ass 都不生成：降级占位镜头的「占位」提示 cue 也不该出现。
  const subtitleAss =
    assembly.subtitles === 'burn-in'
      ? await exportPhase('subtitle', () => buildSubtitleAss(assembly, storage))
      : null
  const workDirectory = await exportPhase('workspace', () =>
    storage.tempDir('cvc-export-')
  )
  try {
    const temporaryOutput = path.join(workDirectory, 'final.mp4')
    const concatResult = await exportPhase('concat', async () => {
      const paths = await materializeAssemblyPaths(assembly, storage)
      return concat(
        assembly,
        paths,
        subtitleAss,
        temporaryOutput
      )
    })
    const bytes = await exportPhase('read-output', () =>
      storage.readLocalFile(temporaryOutput)
    )
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const outputKey = await exportPhase('store-output', () =>
      storage.put(
        finalVideoStorageKey({ projectId, attemptId, contentHash }),
        bytes
      )
    )
    let soundEffectsManifest: Awaited<
      ReturnType<typeof storeProceduralSfxManifest>
    > | null = null
    try {
      const storedManifest = await exportPhase('store-sfx-manifest', () =>
        storeProceduralSfxManifest(storage, {
          projectId,
          attemptId,
          finalContentHash: contentHash,
          soundEffects: concatResult.soundEffects,
        })
      )
      soundEffectsManifest = storedManifest
      const registered = await exportPhase('register-artifacts', () =>
        repository.registerFinalDelivery({
          projectId,
          attemptId,
          outputKey,
          finalContentHash: contentHash,
          finalSizeBytes: bytes.byteLength,
          subtitles: assembly.subtitles,
          soundEffectsManifest: storedManifest,
        })
      )
      return {
        ok: true,
        artifactId: registered.finalArtifactId,
        outputKey,
        contentHash,
      }
    } catch (error) {
      await storage.delete(outputKey)
      if (soundEffectsManifest) {
        await storage.delete(soundEffectsManifest.storageKey)
      }
      throw error
    }
  } finally {
    await storage.removeTempDir(workDirectory)
  }
}

async function materializeAssemblyPaths(
  assembly: NonNullable<RenderExportPlan['mediaAssemblyPlan']>,
  storage: StorageAdapter,
) {
  const videoPaths = await Promise.all(
    assembly.shots.map((shot) =>
      storage.materializeLocalPath(shot.video.storageKey)
    ),
  )
  const narrationPaths = await Promise.all(
    assembly.shots.map((shot) =>
      storage.materializeLocalPath(shot.narration.artifact.storageKey)
    ),
  )
  const musicPath = assembly.musicKey
    ? await storage.materializeLocalPath(assembly.musicKey)
    : null
  return { videoPaths, narrationPaths, musicPath }
}

export class ExportExecutionError extends Error {
  override readonly name = 'ExportExecutionError'

  constructor(
    readonly safeDetails: {
      phase: string
      causeName: string
    }
  ) {
    super('终片导出在平台执行阶段失败')
  }
}

async function exportPhase<T>(
  phase: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ExportExecutionError) throw error
    throw new ExportExecutionError({
      phase,
      causeName: error instanceof Error ? error.name : 'NonErrorThrown',
    })
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
