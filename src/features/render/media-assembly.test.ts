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

function twoShotInput() {
  const input = validInput()
  // 第二个 lane：有旁白 U002（合同一致），但缺 shot-codegen 产物与字幕。
  input.nodes.push({
    nodeId: 'codegen-S002',
    type: 'shot-codegen',
    status: 'failed',
    laneKey: 'S002',
  })
  input.artifacts.push(
    artifact({
      artifactId: 'narration-U002',
      aggregateId: 'ingest-node',
      kind: 'narration-audio:U002',
      storageKey: 'audio/U002.mp3',
    })
  )
  input.audioManifest.units.push({
    unitId: 'U002',
    audioFile: 'audio/U002.mp3',
    sha256: `sha256:${HASH}`,
  })
  input.audioAllocation.totalFrames = 120
  input.audioAllocation.shots.push({
    id: 'S002',
    audioUnitId: 'U002',
    startInUnitMs: 0,
    endInUnitMs: 2_000,
    durationInFrames: 60,
  })
  return input
}

describe('assembleTrustedMediaPlan (degraded)', () => {
  it('occupies a render-less lane with a placeholder video and drops its subtitle', () => {
    const input = {
      ...twoShotInput(),
      degraded: true,
      placeholderVideos: new Map([
        [
          'S002',
          {
            artifactId: 'placeholder-video:S002',
            storageKey: 'exports/p/placeholders/S002.mp4',
            contentHash: OTHER_HASH,
          },
        ],
      ]),
    }

    const result = assembleTrustedMediaPlan(input)

    expect(result.blockingIssues).toEqual([])
    expect(result.placeholderLaneKeys).toEqual(['S002'])
    expect(result.plan?.shots).toHaveLength(2)
    const occupied = result.plan?.shots.find((shot) => shot.laneKey === 'S002')
    expect(occupied?.video.storageKey).toBe('exports/p/placeholders/S002.mp4')
    expect(occupied?.subtitle).toBeNull()
    expect(occupied?.narration.artifact.storageKey).toBe('audio/U002.mp3')
  })

  it('reports placeholder candidates and yields no plan before clips are supplied', () => {
    const result = assembleTrustedMediaPlan({ ...twoShotInput(), degraded: true })

    expect(result.plan).toBeNull()
    expect(result.blockingIssues).toEqual([])
    expect(result.placeholderCandidates).toEqual([
      {
        laneKey: 'S002',
        durationInFrames: 60,
        audioUnitId: 'U002',
        needsVideo: true,
        needsNarration: false,
      },
    ])
    expect(result.placeholderLaneKeys).toEqual([])
  })

  it('routes a skipped lane into degraded placeholding instead of blocking', () => {
    // 与 failed 同构：skipped 的 codegen 无 render-mp4 产物，严格装配必须阻塞，
    // 降级装配则将其列为占位候选（routing.md 跳过合同）。
    const input = twoShotInput()
    const skippedLane = input.nodes.find((node) => node.nodeId === 'codegen-S002')!
    skippedLane.status = 'skipped'

    const strict = assembleTrustedMediaPlan(input)
    expect(strict.plan).toBeNull()
    // render 维度按 (laneKey, kind) 去重：node-incomplete 已覆盖产物缺失。
    expect(strict.blockingIssues).toEqual([
      { laneKey: 'S002', kind: 'render', code: 'node-incomplete' },
      { laneKey: 'S002', kind: 'subtitle', code: 'artifact-missing' },
    ])

    const degraded = assembleTrustedMediaPlan({ ...input, degraded: true })
    expect(degraded.blockingIssues).toEqual([])
    expect(degraded.placeholderCandidates).toEqual([
      {
        laneKey: 'S002',
        durationInFrames: 60,
        audioUnitId: 'U002',
        needsVideo: true,
        needsNarration: false,
      },
    ])
  })

  it('binds a silent narration placeholder spanning the full shot duration', () => {
    const input = twoShotInput()
    input.artifacts = input.artifacts.filter(
      (item) => item.kind !== 'narration-audio:U002'
    )
    const result = assembleTrustedMediaPlan({
      ...input,
      degraded: true,
      placeholderVideos: new Map([
        ['S002', { artifactId: 'ph-v', storageKey: 'ph/S002.mp4', contentHash: OTHER_HASH }],
      ]),
      placeholderNarrations: new Map([
        ['S002', { artifactId: 'ph-a', storageKey: 'ph/S002.wav', contentHash: HASH }],
      ]),
    })

    const occupied = result.plan?.shots.find((shot) => shot.laneKey === 'S002')
    expect(occupied?.narration).toEqual({
      unitId: 'U002',
      artifact: { artifactId: 'ph-a', storageKey: 'ph/S002.wav', contentHash: HASH },
      startInUnitMs: 0,
      endInUnitMs: 2_000,
    })
  })
})
