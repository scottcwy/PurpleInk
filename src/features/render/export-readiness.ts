import 'server-only'
import { createHash } from 'node:crypto'
import type { ResolutionPreset } from '@/features/canvas'
import { isDegradable } from './export-degraded'
import {
  RenderRepository,
  type ExportPlanOptions,
  type FinalArtifactRecord,
  type RenderExportPlan,
} from './repository'

/**
 * 导出就绪投影与幂等指纹。
 *
 * 从 `export-service.ts` 拆出：那边负责「执行一次导出」（装配、ffmpeg、落盘、
 * 登记产物），这边负责「回答当前能不能导出、导出过什么」。两者的读者也不同——
 * 前者只有队列 handler，后者同时服务 `GET /api/render/export` 与降级确认校验。
 */

export type ExportArtifactDelivery =
  | 'none'
  | 'legacy-silent-v1'
  | 'narration-hard-subtitle-v2'

export interface ExportReadinessResult {
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
  /** 当前降级范围与输入真值的确认摘要；仅 degradedReady 时存在。 */
  confirmationFingerprint: string | null
  /** 当前完整或降级装配输入的规范化摘要，用于导出任务幂等。 */
  inputFingerprint: string
  /** 最新成片若为降级产物，列出其占位镜头。 */
  degradedExport: { placeholderLanes: string[]; waivedQaLanes: string[] } | null
  artifactDelivery: ExportArtifactDelivery
}

export interface ExportReadinessRepository {
  getExportPlan(
    projectId: string,
    options?: ExportPlanOptions
  ): Promise<RenderExportPlan>
  findLatestFinalArtifact(projectId: string): Promise<FinalArtifactRecord | null>
  findDegradedExport(
    projectId: string
  ): Promise<{ placeholderLanes: string[]; waivedQaLanes: string[] } | null>
}

export async function getExportReadiness(
  projectId: string,
  repository: ExportReadinessRepository = new RenderRepository()
): Promise<ExportReadinessResult> {
  const plan = await repository.getExportPlan(projectId)
  const finalArtifact = await repository.findLatestFinalArtifact(projectId)
  const ready =
    plan.incompleteNodeIds.length === 0 &&
    plan.blockingIssues.length === 0 &&
    plan.mediaAssemblyPlan !== null
  let placeholderCandidateLanes: string[] = []
  let degradedReady = false
  let degradedPlan: RenderExportPlan | null = null
  if (!ready) {
    const probe = await repository.getExportPlan(projectId, { degraded: true })
    degradedPlan = probe
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
    confirmationFingerprint: degradedReady && degradedPlan
      ? degradedConfirmationFingerprint({
          plan,
          degradedPlan,
          placeholderCandidateLanes,
        })
      : null,
    inputFingerprint: exportInputFingerprint(ready ? plan : (degradedPlan ?? plan)),
    degradedExport: await repository.findDegradedExport(projectId),
    artifactDelivery: finalDelivery(finalArtifact),
  }
}

function exportInputFingerprint(plan: RenderExportPlan): string {
  const canonical = JSON.stringify({
    incompleteNodeIds: [...plan.incompleteNodeIds].sort(),
    shots: plan.shots
      .map((shot) => ({
        nodeId: shot.nodeId,
        laneKey: shot.laneKey,
        outputKey: shot.outputKey,
      }))
      .sort((left, right) => left.laneKey.localeCompare(right.laneKey)),
    resolutionPreset: plan.resolutionPreset,
    shotQa: Object.entries(plan.shotQa).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    waivedQaLanes: [...plan.waivedQaLanes].sort(),
    placeholderLanes: [...plan.placeholderLaneKeys].sort(),
    blockingIssues: plan.blockingIssues
      .map((issue) => ({
        laneKey: issue.laneKey,
        kind: issue.kind,
        code: issue.code,
      }))
      .sort((left, right) =>
        `${left.laneKey ?? ''}:${left.kind}:${left.code}`.localeCompare(
          `${right.laneKey ?? ''}:${right.kind}:${right.code}`
        )
      ),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function degradedConfirmationFingerprint(input: {
  plan: RenderExportPlan
  degradedPlan: RenderExportPlan
  placeholderCandidateLanes: string[]
}): string {
  const shotQa = Object.entries(input.plan.shotQa)
    .sort(([left], [right]) => left.localeCompare(right))
  const blockingIssues = input.degradedPlan.blockingIssues
    .map((issue) => ({
      laneKey: issue.laneKey,
      kind: issue.kind,
      code: issue.code,
    }))
    .sort((left, right) =>
      `${left.laneKey ?? ''}:${left.kind}:${left.code}`.localeCompare(
        `${right.laneKey ?? ''}:${right.kind}:${right.code}`,
      )
    )
  const canonical = JSON.stringify({
    incompleteNodeIds: [...input.plan.incompleteNodeIds].sort(),
    placeholderCandidateLanes: [...input.placeholderCandidateLanes].sort(),
    waivedQaLanes: [...input.plan.waivedQaLanes].sort(),
    resolutionPreset: input.plan.resolutionPreset,
    shotQa,
    blockingIssues,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function finalDelivery(
  artifact: FinalArtifactRecord | null
): ExportArtifactDelivery {
  if (!artifact) return 'none'
  return artifact.schemaVersion === 'cvc.final-video/v2'
    ? 'narration-hard-subtitle-v2'
    : 'legacy-silent-v1'
}
