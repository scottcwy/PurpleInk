import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Jimp } from 'jimp'
import {
  BLACK_FRAME_LUMINANCE_THRESHOLD,
  SOLID_COLOR_STDDEV_THRESHOLD,
  checkThumbnailQa,
  runShotQaCheck,
  runShotQaChecks,
  type ShotQaDependencies,
} from './qa-check'
import type { ShotQaCheckData, ThumbnailContext, ThumbnailResult } from './types'

vi.mock('server-only', () => ({}))

/** 造一张 1 行的 PNG，每列一个 [r,g,b] 像素（alpha 恒 255）；8-bit 无损，round-trip 精确。 */
async function pngOf(pixels: ReadonlyArray<readonly [number, number, number]>): Promise<Buffer> {
  const image = new Jimp({ width: pixels.length, height: 1, color: 0x000000ff })
  pixels.forEach(([r, g, b], x) => {
    const index = x * 4
    image.bitmap.data[index] = r
    image.bitmap.data[index + 1] = g
    image.bitmap.data[index + 2] = b
    image.bitmap.data[index + 3] = 255
  })
  return image.getBuffer('image/png')
}

describe('checkThumbnailQa', () => {
  it('flags a pure black frame as failed', async () => {
    const result = await checkThumbnailQa(await pngOf([[0, 0, 0], [0, 0, 0]]), '25%')
    expect(result.meanLuminance).toBeLessThan(BLACK_FRAME_LUMINANCE_THRESHOLD)
    expect(result).toMatchObject({ label: '25%', isBlackFrame: true, passed: false })
  })

  it('flags a near-solid (non-black) frame as failed', async () => {
    const result = await checkThumbnailQa(await pngOf([[128, 128, 128], [128, 128, 128]]), '60%')
    expect(result.isBlackFrame).toBe(false)
    expect(result.luminanceStdDev).toBeLessThan(SOLID_COLOR_STDDEV_THRESHOLD)
    expect(result).toMatchObject({ isNearSolidColor: true, passed: false })
  })

  it('passes a frame with real luminance variance', async () => {
    const result = await checkThumbnailQa(await pngOf([[0, 0, 0], [255, 255, 255]]), '95%')
    expect(result).toMatchObject({ isBlackFrame: false, isNearSolidColor: false, passed: true })
  })

  it('treats mean just above the black threshold with variance as passing', async () => {
    // 亮度 5 与 15，均值 10（>8 非黑帧），标准差 5（>2 非纯色）。
    const result = await checkThumbnailQa(await pngOf([[5, 5, 5], [15, 15, 15]]), '25%')
    expect(result.meanLuminance).toBeGreaterThan(BLACK_FRAME_LUMINANCE_THRESHOLD)
    expect(result.passed).toBe(true)
  })

  it('treats mean just below the black threshold as a black frame', async () => {
    const result = await checkThumbnailQa(await pngOf([[3, 3, 3], [5, 5, 5]]), '25%')
    expect(result.meanLuminance).toBeLessThan(BLACK_FRAME_LUMINANCE_THRESHOLD)
    expect(result).toMatchObject({ isBlackFrame: true, passed: false })
  })
})

describe('runShotQaChecks', () => {
  const context: ThumbnailContext = {
    projectId: 'p',
    nodeId: 'c1',
    htmlKey: 'html/c1.html',
    frames: { fps: 30, durationInFrames: 10, width: 2, height: 1 },
  }
  const thumbnails: ThumbnailResult[] = [
    { fraction: 0.25, frame: 0, artifactId: 'a1', contentHash: 'h1' },
    { fraction: 0.6, frame: 5, artifactId: 'a2', contentHash: 'h2' },
    { fraction: 0.95, frame: 9, artifactId: 'a3', contentHash: 'h3' },
  ]
  const expectedHash = createHash('sha256').update('h1\0h2\0h3').digest('hex')

  function makeDeps() {
    let stored: ShotQaCheckData | null = null
    const written: ShotQaCheckData[] = []
    const check = vi.fn(async (_buffer: Buffer, label: string) => ({
      label,
      meanLuminance: 100,
      luminanceStdDev: 40,
      isBlackFrame: false,
      isNearSolidColor: false,
      passed: true,
    }))
    const deps: ShotQaDependencies = {
      repository: {
        getShotQaTargets: async () => [
          { codegenNodeId: 'c1', qaNodeId: 'q1', laneKey: 'S001' },
        ],
        loadCompletedThumbnailContext: async () => context,
        readShotQaCheck: async () => stored,
        writeShotQaCheck: async (_nodeId, qaCheck) => {
          written.push(qaCheck)
          stored = qaCheck
        },
      },
      capture: vi.fn(async () => thumbnails),
      readArtifactBytes: vi.fn(async () => Buffer.alloc(0)),
      check,
      now: () => 123,
    }
    return { deps, written, check }
  }

  it('writes an aggregated qaCheck for each target', async () => {
    const { deps, written, check } = makeDeps()
    await runShotQaChecks('p', deps)
    expect(check).toHaveBeenCalledTimes(3)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      passed: true,
      checkedAt: 123,
      thumbnailContentHash: expectedHash,
    })
    expect(written[0]?.results).toHaveLength(3)
  })

  it('skips recomputation when the thumbnail content hash is unchanged', async () => {
    const { deps, written, check } = makeDeps()
    await runShotQaChecks('p', deps)
    check.mockClear()
    await runShotQaChecks('p', deps)
    expect(check).not.toHaveBeenCalled()
    expect(written).toHaveLength(1)
  })

  it('isolates per-shot failures without aborting the batch', async () => {
    const { deps } = makeDeps()
    const boom = vi.fn(async () => {
      throw new Error('capture failed')
    })
    await expect(
      runShotQaChecks('p', { ...deps, capture: boom as unknown as ShotQaDependencies['capture'] })
    ).resolves.toBeUndefined()
  })

  it('runs one requested shot strictly and surfaces missing targets', async () => {
    const { deps, written } = makeDeps()

    await runShotQaCheck('p', 'q1', deps)
    expect(written).toHaveLength(1)

    await expect(runShotQaCheck('p', 'missing', deps)).rejects.toThrow(
      '不具备 QA 前置条件'
    )
  })
})
