import { describe, expect, it } from 'vitest'
import { assembleTrustedMediaPlan } from './media-assembly'

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)

function artifact(
  overrides: Partial<{
    artifactId: string
    aggregateId: string
    kind: string
    storageKey: string
    contentHash: string
    version: number
  }> = {}
) {
  return {
    artifactId: 'artifact',
    aggregateId: 'codegen-S001',
    kind: 'render-mp4',
    storageKey: 'render/S001.mp4',
    contentHash: HASH,
    version: 1,
    ...overrides,
  }
}

function validInput() {
  return {
    nodes: [
      { nodeId: 'codegen-S001', type: 'shot-codegen', status: 'succeeded', laneKey: 'S001' },
      { nodeId: 'subtitle-S001', type: 'shot-subtitle', status: 'succeeded', laneKey: 'S001' },
    ],
    artifacts: [
      artifact(),
      artifact({
        artifactId: 'narration-U001',
        aggregateId: 'ingest-node',
        kind: 'narration-audio:U001',
        storageKey: 'audio/U001.mp3',
      }),
      artifact({
        artifactId: 'subtitle-track-S001',
        aggregateId: 'subtitle-S001',
        kind: 'subtitle-track',
        storageKey: 'audio/S001/subtitle.json',
      }),
    ],
    subtitleTracks: {
      'subtitle-track-S001': {
        shotId: 'S001',
        sourceAudioArtifactId: 'narration-U001',
        sourceAudioKey: 'audio/U001.mp3',
      },
    },
    audioManifest: {
      units: [
        {
          unitId: 'U001',
          audioFile: 'audio/U001.mp3',
          sha256: `sha256:${HASH}`,
        },
      ],
    },
    audioAllocation: {
      fps: 30 as const,
      totalFrames: 60,
      shots: [
        {
          id: 'S001',
          audioUnitId: 'U001',
          startInUnitMs: 0,
          endInUnitMs: 2_000,
          durationInFrames: 60,
        },
      ],
    },
    targetResolution: { width: 1920, height: 1080 },
    musicKey: null,
  }
}

describe('assembleTrustedMediaPlan', () => {
  it('selects the latest trusted artifacts and derives timing only from audioAllocation', () => {
    const input = validInput()
    input.artifacts.unshift(
      artifact({
        artifactId: 'render-latest',
        storageKey: 'render/S001-v2.mp4',
        contentHash: OTHER_HASH,
        version: 2,
      })
    )

    const result = assembleTrustedMediaPlan(input)

    expect(result.blockingIssues).toEqual([])
    expect(result.plan).toEqual({
      fps: 30,
      totalFrames: 60,
      targetResolution: { width: 1920, height: 1080 },
      musicKey: null,
      shots: [
        {
          laneKey: 'S001',
          video: {
            artifactId: 'render-latest',
            storageKey: 'render/S001-v2.mp4',
            contentHash: OTHER_HASH,
          },
          durationInFrames: 60,
          narration: {
            unitId: 'U001',
            artifact: {
              artifactId: 'narration-U001',
              storageKey: 'audio/U001.mp3',
              contentHash: HASH,
            },
            startInUnitMs: 0,
            endInUnitMs: 2_000,
          },
          subtitle: {
            artifactId: 'subtitle-track-S001',
            storageKey: 'audio/S001/subtitle.json',
            contentHash: HASH,
          },
        },
      ],
    })
  })

  it('rejects cross-lane subtitles and narration hashes that disagree with the ingest manifest', () => {
    const input = validInput()
    input.subtitleTracks['subtitle-track-S001']!.shotId = 'S002'
    input.audioManifest.units[0]!.sha256 = `sha256:${OTHER_HASH}`

    const result = assembleTrustedMediaPlan(input)

    expect(result.plan).toBeNull()
    expect(result.blockingIssues).toEqual([
      { laneKey: 'S001', kind: 'narration', code: 'artifact-invalid' },
      { laneKey: 'S001', kind: 'subtitle', code: 'artifact-invalid' },
    ])
  })

  it('reports missing media and invalid accumulated frame totals without producing a plan', () => {
    const input = validInput()
    input.artifacts = input.artifacts.filter(
      (item) => item.kind !== 'narration-audio:U001' && item.kind !== 'subtitle-track'
    )
    input.audioAllocation.totalFrames = 61

    const result = assembleTrustedMediaPlan(input)

    expect(result.plan).toBeNull()
    expect(result.blockingIssues).toEqual([
      { laneKey: null, kind: 'render', code: 'artifact-invalid' },
      { laneKey: 'S001', kind: 'narration', code: 'artifact-missing' },
      { laneKey: 'S001', kind: 'subtitle', code: 'artifact-missing' },
    ])
  })
})
