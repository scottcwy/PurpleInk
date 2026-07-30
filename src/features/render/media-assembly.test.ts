import { describe, expect, it } from 'vitest'
import {
  assembleTrustedMediaPlan,
  type TrustedMediaInput,
} from './media-assembly'

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

function validInput(): TrustedMediaInput {
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
    subtitles: 'burn-in',
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
      subtitles: 'burn-in',
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

  it('keeps subtitles valid when narration is re-run into a new artifact version with identical bytes', () => {
    // 旁白重跑：artifacts 无 content-hash 去重，同字节也会得到新版本与新 artifactId。
    // 字幕血缘只记录旧 artifactId，但存储键是内容寻址的，因此仍然同源，不得阻塞导出。
    const input = validInput()
    input.artifacts.unshift(
      artifact({
        artifactId: 'narration-U001-rerun',
        aggregateId: 'ingest-node',
        kind: 'narration-audio:U001',
        storageKey: 'audio/U001.mp3',
        version: 2,
      })
    )

    const result = assembleTrustedMediaPlan(input)

    expect(result.blockingIssues).toEqual([])
    expect(result.plan?.shots[0]?.narration.artifact.artifactId).toBe(
      'narration-U001-rerun'
    )
    expect(result.plan?.shots[0]?.subtitle).toEqual({
      artifactId: 'subtitle-track-S001',
      storageKey: 'audio/S001/subtitle.json',
      contentHash: HASH,
    })
  })

  it('rejects subtitles whose narration source key no longer matches the trusted narration', () => {
    // 反向保护：text / voice / model 任一改变都会改变内容寻址键，此时必须阻塞。
    const input = validInput()
    input.subtitleTracks['subtitle-track-S001']!.sourceAudioKey =
      'audio/U001-old-voice.mp3'

    const result = assembleTrustedMediaPlan(input)

    expect(result.plan).toBeNull()
    expect(result.blockingIssues).toEqual([
      { laneKey: 'S001', kind: 'subtitle', code: 'artifact-invalid' },
    ])
  })

  it('drops subtitles entirely when the delivery excludes them', () => {
    const input: TrustedMediaInput = { ...validInput(), subtitles: 'off' }

    const result = assembleTrustedMediaPlan(input)

    expect(result.blockingIssues).toEqual([])
    expect(result.plan?.subtitles).toBe('off')
    // 已经存在的字幕产物也不入片：关闭是关闭，不是「有就带上」。
    expect(result.plan?.shots[0]?.subtitle).toBeNull()
  })

  it('does not block a subtitle-free delivery on missing or untrusted subtitles', () => {
    // 这是「关了也导不出」的回归锁：关闭字幕后，缺产物、节点未完成、血缘不同源
    // 三种情况都不得再产生 subtitle 阻塞项。
    const missing: TrustedMediaInput = { ...validInput(), subtitles: 'off' }
    missing.artifacts = missing.artifacts.filter(
      (item) => item.kind !== 'subtitle-track'
    )
    expect(assembleTrustedMediaPlan(missing).blockingIssues).toEqual([])
    expect(assembleTrustedMediaPlan(missing).plan?.shots).toHaveLength(1)

    const stale: TrustedMediaInput = { ...validInput(), subtitles: 'off' }
    stale.subtitleTracks['subtitle-track-S001']!.sourceAudioKey = 'audio/other.mp3'
    expect(assembleTrustedMediaPlan(stale).blockingIssues).toEqual([])

    const incomplete: TrustedMediaInput = { ...validInput(), subtitles: 'off' }
    incomplete.nodes = incomplete.nodes.map((node) =>
      node.type === 'shot-subtitle' ? { ...node, status: 'failed' } : node
    )
    expect(assembleTrustedMediaPlan(incomplete).blockingIssues).toEqual([])
  })

  it('still blocks a subtitle-free delivery on render and narration problems', () => {
    // 关字幕只豁免字幕，不豁免骨架：画面和旁白缺失照旧阻塞。
    const input: TrustedMediaInput = { ...validInput(), subtitles: 'off' }
    input.artifacts = input.artifacts.filter(
      (item) => item.kind !== 'render-mp4' && item.kind !== 'narration-audio:U001'
    )

    const result = assembleTrustedMediaPlan(input)

    expect(result.plan).toBeNull()
    expect(result.blockingIssues).toEqual([
      { laneKey: 'S001', kind: 'render', code: 'artifact-missing' },
      { laneKey: 'S001', kind: 'narration', code: 'artifact-missing' },
    ])
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
