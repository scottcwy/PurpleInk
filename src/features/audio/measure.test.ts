import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { measureAudio } from './measure'
import { readMp3FrameHeader } from './mp3-frame-header'
import { mp3Frames } from './mp3.fixture'
import { wavBytes } from './wav.fixture'

vi.mock('server-only', () => ({}))

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

describe('measureAudio', () => {
  it('derives duration from decoded sample count, not from the frame count', async () => {
    // 3 帧 × 1152 samples = 3456 samples；gapless 裁剪后真实采样数更少。
    const decode = vi.fn(async () => 2 * 2351)

    const measured = await measureAudio(mp3Frames(3), decode)

    expect(decode).toHaveBeenCalledWith(expect.any(Buffer), 32_000)
    expect(measured).toEqual({
      sampleCount: 2351,
      sampleRateHz: 32_000,
      durationMs: (2351 / 32_000) * 1000,
      container: 'mp3',
    })
  })

  /**
   * 真实事故回归：MiMo TTS 返回 24 kHz WAV，旧实现只解析 MPEG 帧头，会在 PCM
   * 里撞到伪帧头并记下伪造采样率（实测 48000 / 44100 / 12000 / 22050），
   * 撞不到时直接抛错让整条链路失败。采样率必须来自 WAV 的 fmt chunk。
   */
  it('reads the native rate from a WAV container instead of a fake MPEG frame', async () => {
    const bytes = wavBytes({ sampleRateHz: 24_000, sampleCount: 12_000 })
    const decode = vi.fn(async () => 2 * 12_000)

    const measured = await measureAudio(bytes, decode)

    expect(decode).toHaveBeenCalledWith(expect.any(Buffer), 24_000)
    expect(measured).toEqual({
      sampleCount: 12_000,
      sampleRateHz: 24_000,
      durationMs: 500,
      container: 'wav',
    })
  })

  it('refuses empty bytes and impossible decode output', async () => {
    await expect(measureAudio(Buffer.alloc(0))).rejects.toThrow('音频字节为空')
    await expect(measureAudio(mp3Frames(2), async () => 0)).rejects.toThrow(
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

    const measured = await measureAudio(bytes)

    expect(measured.container).toBe('mp3')
    expect(measured.sampleRateHz).toBe(32_000)
    expect(measured.durationMs).toBeGreaterThan(4900)
    expect(measured.durationMs).toBeLessThan(5000)
  })
})
