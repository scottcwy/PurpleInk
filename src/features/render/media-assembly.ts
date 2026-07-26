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
  subtitle: ArtifactRef
}

export interface MediaAssemblyPlan {
  fps: 24 | 30 | 60
  totalFrames: number
  shots: MediaAssemblyShot[]
  targetResolution: { width: number; height: number }
  musicKey: string | null
}

export interface ExportBlockingIssue {
  laneKey: string | null
  kind: 'render' | 'narration' | 'subtitle'
  code: 'node-incomplete' | 'artifact-missing' | 'artifact-invalid'
}

interface MediaNode {
  nodeId: string
  type: string
  status: string
  laneKey: string
}

interface MediaArtifact extends ArtifactRef {
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

interface ShotAllocation {
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
}

export function assembleTrustedMediaPlan(input: TrustedMediaInput): {
  plan: MediaAssemblyPlan | null
  blockingIssues: ExportBlockingIssue[]
} {
  const issues: ExportBlockingIssue[] = []
  const shots: MediaAssemblyShot[] = []
  const frameTotal = input.audioAllocation.shots.reduce(
    (total, shot) => total + shot.durationInFrames,
    0
  )
  if (frameTotal !== input.audioAllocation.totalFrames) {
    addIssue(issues, null, 'render', 'artifact-invalid')
  }

  for (const allocation of input.audioAllocation.shots) {
    const laneKey = allocation.id
    const codegenNode = findNode(input.nodes, laneKey, 'shot-codegen')
    const subtitleNode = findNode(input.nodes, laneKey, 'shot-subtitle')
    checkNode(issues, codegenNode, laneKey, 'render')
    checkNode(issues, subtitleNode, laneKey, 'subtitle')

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

    if (!video) addIssue(issues, laneKey, 'render', 'artifact-missing')
    if (!narration) {
      addIssue(issues, laneKey, 'narration', 'artifact-missing')
    } else if (
      !manifest ||
      manifest.audioFile !== narration.storageKey ||
      manifest.sha256 !== `sha256:${narration.contentHash}`
    ) {
      addIssue(issues, laneKey, 'narration', 'artifact-invalid')
    }
    if (!subtitle) {
      addIssue(issues, laneKey, 'subtitle', 'artifact-missing')
    } else {
      const lineage = input.subtitleTracks[subtitle.artifactId]
      if (
        !lineage ||
        lineage.shotId !== laneKey ||
        !narration ||
        lineage.sourceAudioArtifactId !== narration.artifactId ||
        lineage.sourceAudioKey !== narration.storageKey
      ) {
        addIssue(issues, laneKey, 'subtitle', 'artifact-invalid')
      }
    }

    if (video && narration && subtitle) {
      shots.push({
        laneKey,
        video: toRef(video),
        durationInFrames: allocation.durationInFrames,
        narration: {
          unitId: allocation.audioUnitId,
          artifact: toRef(narration),
          startInUnitMs: allocation.startInUnitMs,
          endInUnitMs: allocation.endInUnitMs,
        },
        subtitle: toRef(subtitle),
      })
    }
  }

  return {
    plan:
      issues.length === 0
        ? {
            fps: input.audioAllocation.fps,
            totalFrames: input.audioAllocation.totalFrames,
            shots,
            targetResolution: input.targetResolution,
            musicKey: input.musicKey,
          }
        : null,
    blockingIssues: issues,
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

function addIssue(
  issues: ExportBlockingIssue[],
  laneKey: string | null,
  kind: ExportBlockingIssue['kind'],
  code: ExportBlockingIssue['code']
): void {
  if (issues.some((item) => item.laneKey === laneKey && item.kind === kind)) return
  issues.push({ laneKey, kind, code })
}
