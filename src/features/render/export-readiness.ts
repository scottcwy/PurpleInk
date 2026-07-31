import 'server-only'
import { createHash } from 'node:crypto'
import { PROCEDURAL_SFX_GENERATOR_VERSION } from '@purpleink/procedural-sfx'
import type {
  ResolutionPreset,
  SubtitleDeliveryMode,
} from '@/features/canvas'
import { isDegradable } from './export-degraded'
import {
  deliveryForSubtitles,
  deliveryFromSchemaVersion,
  type FinalVideoDelivery,
} from './final-video-delivery'
import {
  RenderRepository,
  type ExportPlanOptions,
  type FinalArtifactRecord,
  type RenderExportPlan,
} from './repository'
import {
  proceduralSfxPlanFingerprintFacts,
  type ProceduralSfxManifest,
} from './procedural-sfx-manifest'
import { readFinalProceduralSfx } from './procedural-sfx-read'

/**
 * 导出就绪投影与幂等指纹。
 *
 * 从 `export-service.ts` 拆出：那边负责「执行一次导出」（装配、ffmpeg、落盘、
 * 登记产物），这边负责「回答当前能不能导出、导出过什么」。两者的读者也不同——
 * 前者只有队列 handler，后者同时服务 `GET /api/render/export` 与降级确认校验。
 */

export type ExportArtifactDelivery = 'none' | FinalVideoDelivery
export interface ExportArtifactSoundEffects {
  mode: 'off' | 'procedural'
  status:
    | 'applied'
    | 'omitted-off'
    | 'omitted-no-cues'
    | 'omitted-unsupported'
    | 'omitted-error'
  generatorVersion: 'procedural-sfx/1.0.0'
  cueCount: number
  timingHash: string | null
  cuePlanHash: string | null
  waveformHashes: string[]
  failureCode?: 'PROCEDURAL_SFX_MIX_FAILED'
}

export interface ExportReadinessResult {
  ready: boolean
  incompleteNodeIds: string[]
  shotCount: number
  shotQa: Record<string, boolean | null>
  /** 当前被人工豁免、未经验收的分镜。 */
  waivedQaLanes: string[]
  resolutionPreset: ResolutionPreset
  /** 当前导出设置里的字幕交付选择（下次导出会产出什么）。 */
  subtitles: SubtitleDeliveryMode
  soundEffects: NonNullable<RenderExportPlan['soundEffects']>
  /** 最新成片实际音效；只来自与 final attempt/hash 严格绑定的 Manifest。 */
  artifactSoundEffects: ExportArtifactSoundEffects | null
  artifactLifecycle: 'draft' | 'approved' | 'released' | 'rejected' | null
  artifactAttemptStatus:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'superseded'
    | null
  artifactSettingsMatch: boolean
  artifactDownloadable: boolean
  finalArtifactId: string | null
  /** 最新成片的可追溯事实；无成片时为 null。 */
  finalArtifact: {
    artifactId: string
    contentHash: string
    sizeBytes: number
    delivery: FinalVideoDelivery
    attemptId: string
    lifecycle: ExportReadinessResult['artifactLifecycle']
    attemptStatus: ExportReadinessResult['artifactAttemptStatus']
    settingsMatch: boolean
    downloadable: boolean
  } | null
  blockingIssues: RenderExportPlan['blockingIssues']
  media: RenderExportPlan['media']
  /** 时间轴真值（来自 INGEST 分配合同），供导出页按真实时长排布轨道。 */
  timeline: RenderExportPlan['timeline']
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

type FinalSoundEffectsReader = (
  projectId: string,
  final: FinalArtifactRecord
) => Promise<ProceduralSfxManifest | null>

export async function getExportReadiness(
  projectId: string,
  repository: ExportReadinessRepository = new RenderRepository(),
  readSoundEffects?: FinalSoundEffectsReader
): Promise<ExportReadinessResult> {
  const plan = await repository.getExportPlan(projectId)
  const finalArtifact = await repository.findLatestFinalArtifact(projectId)
  const artifactManifest = finalArtifact
    ? await resolveSoundEffectsReader(repository, readSoundEffects)(
        projectId,
        finalArtifact,
      )
    : null
  const artifactSoundEffects = soundEffectsProjection(artifactManifest)
  const artifactLifecycle = finalLifecycle(finalArtifact?.lifecycle)
  const artifactAttemptStatus = finalAttemptStatus(finalArtifact?.attemptStatus)
  const artifactSettingsMatch =
    artifactSoundEffects !== null
    && artifactSoundEffects.mode === (plan.soundEffects ?? 'off')
    && finalArtifact !== null
    && deliveryFromSchemaVersion(finalArtifact.schemaVersion)
      === deliveryForSubtitles(plan.subtitles)
  const artifactDownloadable =
    finalArtifact !== null
    && (artifactLifecycle === 'approved' || artifactLifecycle === 'released')
    && artifactAttemptStatus === 'succeeded'
    && artifactSettingsMatch
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
    subtitles: plan.subtitles,
    soundEffects: plan.soundEffects ?? 'off',
    artifactSoundEffects,
    artifactLifecycle,
    artifactAttemptStatus,
    artifactSettingsMatch,
    artifactDownloadable,
    finalArtifactId: finalArtifact?.artifactId ?? null,
    finalArtifact: finalArtifact
      ? {
          artifactId: finalArtifact.artifactId,
          contentHash: finalArtifact.contentHash,
          sizeBytes: finalArtifact.sizeBytes,
          delivery: deliveryFromSchemaVersion(finalArtifact.schemaVersion),
          attemptId: finalArtifact.attemptId,
          lifecycle: artifactLifecycle,
          attemptStatus: artifactAttemptStatus,
          settingsMatch: artifactSettingsMatch,
          downloadable: artifactDownloadable,
        }
      : null,
    blockingIssues: plan.blockingIssues,
    media: plan.media,
    timeline: plan.timeline,
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
    // 交付形态必须进指纹：不进的话切换字幕开关后重导出会命中同一个已完成作业、
    // 直接返回上一版成片，开关就成了静默失效的假开关。musicKey 同理——它现在
    // 恒为 null（配乐是只留接口的桩），但一旦接上就是同一个坑，先补掉更便宜。
    subtitles: plan.subtitles,
    soundEffects: plan.mediaAssemblyPlan
      ? proceduralSfxPlanFingerprintFacts(plan.mediaAssemblyPlan)
      : {
          mode: plan.soundEffects ?? 'off',
          generatorVersion: PROCEDURAL_SFX_GENERATOR_VERSION,
          cueCount: 0,
          timingHash: null,
          cuePlanHash: null,
        },
    musicKey: plan.musicKey,
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
    subtitles: input.plan.subtitles,
    soundEffects: input.plan.soundEffects ?? 'off',
    shotQa,
    blockingIssues,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function resolveSoundEffectsReader(
  repository: ExportReadinessRepository,
  supplied?: FinalSoundEffectsReader,
): FinalSoundEffectsReader {
  if (supplied) return supplied
  return repository instanceof RenderRepository
    ? readFinalProceduralSfx
    : async () => null
}

function soundEffectsProjection(
  manifest: Awaited<ReturnType<typeof readFinalProceduralSfx>>,
): ExportArtifactSoundEffects | null {
  if (!manifest) return null
  return {
    mode: manifest.mode,
    status: manifest.status,
    generatorVersion: manifest.generatorVersion,
    cueCount: manifest.cueCount,
    timingHash: manifest.timingHash,
    cuePlanHash: manifest.cuePlanHash,
    waveformHashes: manifest.waveformHashes,
    ...(manifest.failureCode ? { failureCode: manifest.failureCode } : {}),
  }
}


function finalDelivery(
  artifact: FinalArtifactRecord | null
): ExportArtifactDelivery {
  if (!artifact) return 'none'
  return deliveryFromSchemaVersion(artifact.schemaVersion)
}

function finalLifecycle(
  value: string | undefined
): ExportReadinessResult['artifactLifecycle'] {
  return ['draft', 'approved', 'released', 'rejected'].includes(value ?? '')
    ? value as ExportReadinessResult['artifactLifecycle']
    : null
}

function finalAttemptStatus(
  value: string | undefined
): ExportReadinessResult['artifactAttemptStatus'] {
  return [
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'superseded',
  ].includes(value ?? '')
    ? value as ExportReadinessResult['artifactAttemptStatus']
    : null
}
