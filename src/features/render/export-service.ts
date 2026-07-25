import 'server-only'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { storage as defaultStorage, type StorageAdapter } from '@/lib/storage'
import type { ResolutionPreset } from '@/features/canvas/contracts'
import { concatExport } from './concat'
import { runShotQaChecks } from './qa-check'
import {
  RenderRepository,
  type FinalArtifactInput,
  type FinalArtifactRecord,
  type RenderExportPlan,
} from './repository'

export type ExportProjectResult =
  | { ok: false; incompleteNodeIds: string[] }
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
  getExportPlan(projectId: string): Promise<RenderExportPlan>
  findLatestFinalArtifact(projectId: string): Promise<FinalArtifactRecord | null>
}

export async function exportProject(
  projectId: string,
  dependencies: ExportDependencies = {}
): Promise<ExportProjectResult> {
  const repository = dependencies.repository ?? new RenderRepository()
  const storage = dependencies.storage ?? defaultStorage
  const concat = dependencies.concat ?? concatExport
  const plan = await repository.getExportPlan(projectId)
  if (plan.incompleteNodeIds.length > 0) {
    return incomplete(plan.incompleteNodeIds)
  }
  const orderedShots = [...plan.shots].sort((left, right) =>
    left.laneKey.localeCompare(right.laneKey)
  )
  const missing = await missingShotIds(orderedShots, storage)
  if (missing.length > 0) return incomplete(missing)
  if (plan.musicKey && !(await storage.exists(plan.musicKey))) {
    throw new Error(`配乐 artifact 文件不存在：${plan.musicKey}`)
  }

  const workDirectory = await storage.tempDir('cvc-export-')
  try {
    const temporaryOutput = path.join(workDirectory, 'final.mp4')
    await concat(
      orderedShots.map((shot) => storage.localPath(shot.outputKey)),
      plan.musicKey ? storage.localPath(plan.musicKey) : null,
      temporaryOutput,
      plan.targetResolution
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
  resolutionPreset: ResolutionPreset
  finalArtifactId: string | null
}> {
  const plan = await repository.getExportPlan(projectId)
  const finalArtifact = await repository.findLatestFinalArtifact(projectId)
  return {
    ready: plan.incompleteNodeIds.length === 0,
    incompleteNodeIds: plan.incompleteNodeIds,
    shotCount: plan.shots.length,
    shotQa: plan.shotQa,
    resolutionPreset: plan.resolutionPreset,
    finalArtifactId: finalArtifact?.artifactId ?? null,
  }
}

/**
 * 幂等触发分镜 Final QA 检测并写回 shot-qa 节点（内部逐 shot 已容错、
 * contentHash 未变自动跳过）。供 readiness 路由在返回前调用，使 shotQa 反映真实结果。
 */
export async function ensureShotQaChecked(projectId: string): Promise<void> {
  await runShotQaChecks(projectId)
}

async function missingShotIds(
  shots: RenderExportPlan['shots'],
  storage: StorageAdapter
): Promise<string[]> {
  const checks = await Promise.all(
    shots.map(async (shot) => ({
      nodeId: shot.nodeId,
      exists: await storage.exists(shot.outputKey),
    }))
  )
  return checks.filter((item) => !item.exists).map((item) => item.nodeId).sort()
}

function incomplete(nodeIds: string[]): ExportProjectResult {
  return { ok: false, incompleteNodeIds: [...new Set(nodeIds)].sort() }
}
