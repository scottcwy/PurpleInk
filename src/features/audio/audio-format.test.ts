import { describe, expect, it } from 'vitest'
import { detectAudioContainer, readAudioStreamInfo } from './audio-format'
import { readWavHeader } from './wav-header'
import { wavBytes } from './wav.fixture'

/** MPEG1 Layer III / 32 kHz / 单声道 / 32 kbps 的最小可同步帧序列。 */
function mp3Frames(count: number): Buffer {
  const frame = Buffer.alloc(144)
  frame[0] = 0xff
  frame[1] = 0xfb
  frame[2] = 0x18
  frame[3] = 0xc0
  return Buffer.concat(Array.from({ length: count }, () => frame))
}

describe('readWavHeader', () => {
  it('reads rate and channels from the fmt chunk', () => {
    expect(readWavHeader(wavBytes({ sampleRateHz: 24_000, sampleCount: 100 })))
      .toMatchObject({ sampleRateHz: 24_000, channels: 1, bitsPerSample: 16 })
  })

  it('refuses bytes that are not a RIFF/WAVE container', () => {
    expect(() => readWavHeader(mp3Frames(2))).toThrow('RIFF/WAVE')
  })
})

describe('readAudioStreamInfo', () => {
  /**
   * 真实事故回归：MiMo TTS 的 24 kHz WAV，PCM 数据里满是 0xFF。若先按 MPEG
   * 帧同步搜索，就会解析出伪造采样率（实测 48000 / 44100 / 12000 / 22050）。
   * 容器判定必须 WAV 优先，采样率必须等于 fmt chunk 声明的真实值。
   */
  it('never mistakes PCM sync bytes in a WAV for an MPEG frame', () => {
    const info = readAudioStreamInfo(
      wavBytes({ sampleRateHz: 24_000, sampleCount: 4_000, fill: 0xff })
    )

    expect(info).toEqual({ container: 'wav', sampleRateHz: 24_000, channels: 1 })
  })

  it('still reads MP3 frame headers', () => {
    expect(readAudioStreamInfo(mp3Frames(3))).toEqual({
      container: 'mp3',
      sampleRateHz: 32_000,
      channels: 1,
    })
  })

  it('refuses empty and unrecognizable bytes instead of guessing', () => {
    expect(() => readAudioStreamInfo(Buffer.alloc(0))).toThrow('音频字节为空')
    expect(() => detectAudioContainer(Buffer.from('not audio at all'))).toThrow(
      'MPEG audio 帧头'
    )
  })
})
