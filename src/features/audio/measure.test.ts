import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { measureMp3 } from './measure'
import { readMp3FrameHeader } from './mp3-frame-header'

vi.mock('server-only', () => ({}))

/** MPEG1 Layer III / 32 kHz / 单声道 / 32 kbps 的最小可同步帧序列。 */
function mp3Frames(count: number): Buffer {
  const frameLength = Math.floor((1152 / 8) * (32_000 / 32_000))
  const frame = Buffer.alloc(frameLength)
  frame[0] = 0xff
  frame[1] = 0xfb // MPEG1, Layer III, 无 CRC
  frame[2] = 0x18 // bitrate index 1 (32 kbps), sample rate index 2 (32 kHz)
  frame[3] = 0xc0 // 单声道
  return Buffer.concat(Array.from({ length: count }, () => frame))
}

describe('readMp3FrameHeader', () => {
  it('reads the native sample rate from real frame bytes', () => {
    const header = readMp3FrameHeader(mp3Frames(3))

    expect(header).toMatchObject({
      offset: 0,
      sampleRateHz: 32_000,
      channels: 1,
      frameLength: 144,
    })
  })

  it('skips an ID3v2 tag before searching for the first frame', () => {
    const tag = Buffer.alloc(10 + 21)
    tag.write('ID3', 0, 'latin1')
    tag[9] = 21
    const header = readMp3FrameHeader(Buffer.concat([tag, mp3Frames(2)]))

    expect(header.offset).toBe(31)
    expect(header.sampleRateHz).toBe(32_000)
  })

  it('rejects bytes that only look like a sync word', () => {
    expect(() =>
      readMp3FrameHeader(Buffer.from([0xff, 0xe0, 0x00, 0x00, 0x00]))
    ).toThrow('MPEG audio 帧头')
  })
})

describe('measureMp3', () => {
  it('derives duration from decoded sample count, not from the frame count', async () => {
    // 3 帧 × 1152 samples = 3456 samples；gapless 裁剪后真实采样数更少。
    const decode = vi.fn(async () => 2 * 2351)

    const measured = await measureMp3(mp3Frames(3), decode)

    expect(decode).toHaveBeenCalledWith(expect.any(Buffer), 32_000)
    expect(measured).toEqual({
      sampleCount: 2351,
      sampleRateHz: 32_000,
      durationMs: (2351 / 32_000) * 1000,
    })
  })

  it('refuses empty bytes and impossible decode output', async () => {
    await expect(measureMp3(Buffer.alloc(0))).rejects.toThrow('音频字节为空')
    await expect(measureMp3(mp3Frames(2), async () => 0)).rejects.toThrow(
      'PCM 字节数无效'
    )
  })

  it('measures a real mp3 file with the bundled ffmpeg decoder', async () => {
    const file = path.join(
      process.cwd(),
      'server/out/cache/localhost-video/audio/segments/000.mp3'
    )
    const bytes = await readFile(file).catch(() => null)
    if (!bytes) return

    const measured = await measureMp3(bytes)

    expect(measured.sampleRateHz).toBe(32_000)
    expect(measured.durationMs).toBeGreaterThan(4900)
    expect(measured.durationMs).toBeLessThan(5000)
  })
})
