import type {
  ArtifactRef,
  ExportBlockingIssue,
  MediaArtifact,
  MediaAssemblyShot,
  MediaNode,
  PlaceholderCandidate,
  ShotAllocation,
  TrustedMediaInput,
} from './media-assembly'

/**
 * 单个分镜的装配解析（正常与降级两条路径）。
 *
 * 从 `media-assembly.ts` 拆出，让编排（`assembleTrustedMediaPlan`）与逐镜产物选择/
 * 校验各自单一职责：`resolveStrictShot` 保留降级前的严格校验与阻塞项顺序（回归锁），
 * `resolveDegradedShot` 用占位顶替缺失产物且不记阻塞项。
 */

export interface ShotResolution {
  shot?: MediaAssemblyShot
  issues: ExportBlockingIssue[]
  candidate?: PlaceholderCandidate
  usedPlaceholderVideo?: boolean
}

interface ShotArtifacts {
  video: MediaArtifact | undefined
  narration: MediaArtifact | undefined
  subtitle: MediaArtifact | undefined
  narrationValid: boolean
  subtitleValid: boolean
}

function resolveShotArtifacts(
  input: TrustedMediaInput,
  allocation: ShotAllocation,
  codegenNode: MediaNode | undefined,
  subtitleNode: MediaNode | undefined
): ShotArtifacts {
  const video = codegenNode
    ? latestArtifact(input.artifacts, codegenNode.nodeId, 'render-mp4')
    : undefined
  const narration = latestKind(
    input.artifacts,
    `narration-audio:${allocation.audioUnitId}`
  )
  const subtitle = subtitleNode
    ? latestArtifact(input.artifacts, subtitleNode.nodeId, 'subtitle-track')
    : undefined
  const manifest = input.audioManifest.units.find(
    (unit) => unit.unitId === allocation.audioUnitId
  )
  const narrationValid = Boolean(
    narration &&
      manifest &&
      manifest.audioFile === narration.storageKey &&
      manifest.sha256 === `sha256:${narration.contentHash}`
  )
  const lineage = subtitle
    ? input.subtitleTracks[subtitle.artifactId]
    : undefined
  // 字幕血缘按「旁白存储键」而不是「旁白 artifactId」判定同源。
  //
  // narrationAudioKey 是 (engine, voice, text) 的 SHA-256 内容寻址键，且
  // reuseNarrationAudio 命中已有键时直接复用字节、不再合成——所以同一个 key
  // 必然是同一份字节、同一个 contentHash，键相等已经是内容等价的证明。
  // 反之 artifacts 提交没有 content-hash 去重（见 features/artifacts/commit.ts），
  // 每次旁白重跑都会插入一个新版本、新 artifactId，即使字节完全一致。用
  // artifactId 比对只会在「旁白重跑过」时把完全正确的字幕判成 artifact-invalid，
  // 永久卡住导出且不会自愈（staleness 只看画布上游节点的 outputContentHash，
  // 不看旁白产物）。lineage 仍然保留 sourceAudioArtifactId 供追溯，只是不再当门禁。
  const subtitleValid = Boolean(
    subtitle &&
      lineage &&
      lineage.shotId === allocation.id &&
      narration &&
      lineage.sourceAudioKey === narration.storageKey
  )
  return { video, narration, subtitle, narrationValid, subtitleValid }
}

/** 正常装配：保留降级前的严格校验与阻塞项顺序（回归锁）。 */
export function resolveStrictShot(
  input: TrustedMediaInput,
  allocation: ShotAllocation
): ShotResolution {
  const issues: ExportBlockingIssue[] = []
  const laneKey = allocation.id
  const codegenNode = findNode(input.nodes, laneKey, 'shot-codegen')
  const subtitleNode = findNode(input.nodes, laneKey, 'shot-subtitle')
  checkNode(issues, codegenNode, laneKey, 'render')
  checkNode(issues, subtitleNode, laneKey, 'subtitle')
  const parts = resolveShotArtifacts(input, allocation, codegenNode, subtitleNode)
  if (!parts.video) addIssue(issues, laneKey, 'render', 'artifact-missing')
  if (!parts.narration) {
    addIssue(issues, laneKey, 'narration', 'artifact-missing')
  } else if (!parts.narrationValid) {
    addIssue(issues, laneKey, 'narration', 'artifact-invalid')
  }
  if (!parts.subtitle) {
    addIssue(issues, laneKey, 'subtitle', 'artifact-missing')
  } else if (!parts.subtitleValid) {
    addIssue(issues, laneKey, 'subtitle', 'artifact-invalid')
  }
  const shot =
    parts.video && parts.narration && parts.subtitle
      ? shotFrom(
          allocation,
          toRef(parts.video),
          narrationBinding(allocation, parts.narration),
          toRef(parts.subtitle)
        )
      : undefined
  return { shot, issues }
}

/** 降级装配：缺渲染用黑场占位、缺旁白用静音、字幕缺失置 null，不记阻塞项。 */
export function resolveDegradedShot(
  input: TrustedMediaInput,
  allocation: ShotAllocation
): ShotResolution {
  const laneKey = allocation.id
  const codegenNode = findNode(input.nodes, laneKey, 'shot-codegen')
  const subtitleNode = findNode(input.nodes, laneKey, 'shot-subtitle')
  const parts = resolveShotArtifacts(input, allocation, codegenNode, subtitleNode)
  const videoRef = parts.video
    ? toRef(parts.video)
    : input.placeholderVideos?.get(laneKey)
  const usedPlaceholderVideo = !parts.video && Boolean(videoRef)
  const narrationRef =
    parts.narrationValid && parts.narration
      ? narrationBinding(allocation, parts.narration)
      : placeholderNarrationBinding(input, allocation)
  const subtitleRef =
    parts.subtitleValid && parts.subtitle ? toRef(parts.subtitle) : null
  const needsVideo = !parts.video
  const needsNarration = !(parts.narrationValid && parts.narration)
  const candidate =
    needsVideo || needsNarration
      ? {
          laneKey,
          durationInFrames: allocation.durationInFrames,
          audioUnitId: allocation.audioUnitId,
          needsVideo,
          needsNarration,
        }
      : undefined
  const shot =
    videoRef && narrationRef
      ? shotFrom(allocation, videoRef, narrationRef, subtitleRef)
      : undefined
  return { shot, issues: [], candidate, usedPlaceholderVideo }
}

function shotFrom(
  allocation: ShotAllocation,
  video: ArtifactRef,
  narration: MediaAssemblyShot['narration'],
  subtitle: ArtifactRef | null
): MediaAssemblyShot {
  return {
    laneKey: allocation.id,
    video,
    durationInFrames: allocation.durationInFrames,
    narration,
    subtitle,
  }
}

function narrationBinding(
  allocation: ShotAllocation,
  narration: MediaArtifact
): MediaAssemblyShot['narration'] {
  return {
    unitId: allocation.audioUnitId,
    artifact: toRef(narration),
    startInUnitMs: allocation.startInUnitMs,
    endInUnitMs: allocation.endInUnitMs,
  }
}

function placeholderNarrationBinding(
  input: TrustedMediaInput,
  allocation: ShotAllocation
): MediaAssemblyShot['narration'] | undefined {
  const ref = input.placeholderNarrations?.get(allocation.id)
  if (!ref) return undefined
  return {
    unitId: allocation.audioUnitId,
    artifact: ref,
    startInUnitMs: 0,
    endInUnitMs: Math.round(
      (allocation.durationInFrames / input.audioAllocation.fps) * 1_000
    ),
  }
}

function findNode(nodes: MediaNode[], laneKey: string, type: string) {
  return nodes.find((node) => node.laneKey === laneKey && node.type === type)
}

function checkNode(
  issues: ExportBlockingIssue[],
  node: MediaNode | undefined,
  laneKey: string,
  kind: ExportBlockingIssue['kind']
): void {
  if (node && node.status !== 'success' && node.status !== 'succeeded') {
    addIssue(issues, laneKey, kind, 'node-incomplete')
  }
}

function latestArtifact(
  artifacts: MediaArtifact[],
  aggregateId: string,
  kind: string
) {
  return artifacts
    .filter(
      (artifact) =>
        artifact.aggregateId === aggregateId && artifact.kind === kind
    )
    .sort((left, right) => right.version - left.version)[0]
}

function latestKind(artifacts: MediaArtifact[], kind: string) {
  return artifacts
    .filter((artifact) => artifact.kind === kind)
    .sort((left, right) => right.version - left.version)[0]
}

function toRef(artifact: MediaArtifact): ArtifactRef {
  return {
    artifactId: artifact.artifactId,
    storageKey: artifact.storageKey,
    contentHash: artifact.contentHash,
  }
}

export function addIssue(
  issues: ExportBlockingIssue[],
  laneKey: string | null,
  kind: ExportBlockingIssue['kind'],
  code: ExportBlockingIssue['code']
): void {
  if (issues.some((item) => item.laneKey === laneKey && item.kind === kind)) return
  issues.push({ laneKey, kind, code })
}
