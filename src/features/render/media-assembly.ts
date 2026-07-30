import type { SubtitleDeliveryMode } from '@/features/canvas/export-settings'
import {
  addIssue,
  resolveDegradedShot,
  resolveStrictShot,
} from './media-assembly-shots'

export interface ArtifactRef {
  artifactId: string
  storageKey: string
  contentHash: string
}

export interface MediaAssemblyShot {
  laneKey: string
  video: ArtifactRef
  durationInFrames: number
  narration: {
    unitId: string
    artifact: ArtifactRef
    startInUnitMs: number
    endInUnitMs: number
  }
  /**
   * 本镜的字幕轨产物。
   *
   * 为 null 有两种成因，含义完全不同，不可混用：
   * - `subtitles === 'burn-in'` 且降级导出把本镜占位——烧一条「占位」提示 cue；
   * - `subtitles === 'off'`——整片不烧字幕，连占位 cue 都不产生。
   * 判定该走哪条永远看 plan 级的 `subtitles`，不要从这里反推。
   */
  subtitle: ArtifactRef | null
}

export interface MediaAssemblyPlan {
  fps: 24 | 30 | 60
  totalFrames: number
  shots: MediaAssemblyShot[]
  targetResolution: { width: number; height: number }
  musicKey: string | null
  /** 本次交付的字幕形态；`off` 时全片不含字幕，缺字幕也不阻塞装配。 */
  subtitles: SubtitleDeliveryMode
}

export interface ExportBlockingIssue {
  laneKey: string | null
  kind: 'render' | 'narration' | 'subtitle'
  code: 'node-incomplete' | 'artifact-missing' | 'artifact-invalid'
}

export interface MediaNode {
  nodeId: string
  type: string
  status: string
  laneKey: string
}

export interface MediaArtifact extends ArtifactRef {
  aggregateId: string
  kind: string
  version: number
}

interface SubtitleLineage {
  shotId: string
  sourceAudioArtifactId: string
  sourceAudioKey: string
}

interface ManifestUnit {
  unitId: string
  audioFile: string
  sha256?: string
}

export interface ShotAllocation {
  id: string
  audioUnitId: string
  startInUnitMs: number
  endInUnitMs: number
  durationInFrames: number
}

export interface TrustedMediaInput {
  nodes: MediaNode[]
  artifacts: MediaArtifact[]
  subtitleTracks: Record<string, SubtitleLineage>
  audioManifest: { units: ManifestUnit[] }
  audioAllocation: {
    fps: 24 | 30 | 60
    totalFrames: number
    shots: ShotAllocation[]
  }
  targetResolution: { width: number; height: number }
  musicKey: string | null
  /** 本次交付的字幕形态；`off` 时不解析也不校验字幕产物。 */
  subtitles: SubtitleDeliveryMode
  /** 降级导出：允许缺渲染/旁白/字幕的 lane 用占位顶替，而不阻塞出片。 */
  degraded?: boolean
  /** laneKey -> 占位黑场视频引用（由 export-degraded 预先生成）。 */
  placeholderVideos?: ReadonlyMap<string, ArtifactRef>
  /** laneKey -> 占位静音旁白引用（旁白缺失时使用）。 */
  placeholderNarrations?: ReadonlyMap<string, ArtifactRef>
}

/** 降级导出待占位的 lane：export-degraded 据此生成占位片段。 */
export interface PlaceholderCandidate {
  laneKey: string
  durationInFrames: number
  audioUnitId: string
  needsVideo: boolean
  needsNarration: boolean
}

export interface AssembleResult {
  plan: MediaAssemblyPlan | null
  blockingIssues: ExportBlockingIssue[]
  /** 降级模式下缺渲染/旁白、待占位的 lane（正常模式恒空）。 */
  placeholderCandidates: PlaceholderCandidate[]
  /** 实际使用了占位视频的 lane（用于成片占位清单，正常模式恒空）。 */
  placeholderLaneKeys: string[]
}

export function assembleTrustedMediaPlan(input: TrustedMediaInput): AssembleResult {
  const issues: ExportBlockingIssue[] = []
  const shots: MediaAssemblyShot[] = []
  const placeholderCandidates: PlaceholderCandidate[] = []
  const placeholderLaneKeys: string[] = []
  const frameTotal = input.audioAllocation.shots.reduce(
    (total, shot) => total + shot.durationInFrames,
    0
  )
  if (frameTotal !== input.audioAllocation.totalFrames) {
    addIssue(issues, null, 'render', 'artifact-invalid')
  }

  for (const allocation of input.audioAllocation.shots) {
    const resolved = input.degraded
      ? resolveDegradedShot(input, allocation)
      : resolveStrictShot(input, allocation)
    issues.push(...resolved.issues)
    if (resolved.shot) shots.push(resolved.shot)
    if (resolved.candidate) placeholderCandidates.push(resolved.candidate)
    if (resolved.usedPlaceholderVideo) placeholderLaneKeys.push(allocation.id)
  }

  // 正常模式：无 issue 即全部 shot 就绪（与旧不变）；降级模式：探测阶段
  // （占位 map 为空）shot 未集齐时 plan 为 null，避免产出残缺时间轴。
  const complete =
    issues.length === 0 && shots.length === input.audioAllocation.shots.length
  return {
    plan: complete
      ? {
          fps: input.audioAllocation.fps,
          totalFrames: input.audioAllocation.totalFrames,
          shots,
          targetResolution: input.targetResolution,
          musicKey: input.musicKey,
          subtitles: input.subtitles,
        }
      : null,
    blockingIssues: issues,
    placeholderCandidates,
    placeholderLaneKeys,
  }
}
