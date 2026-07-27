import { describe, expect, it } from 'vitest'
import {
  VALIDATION_SAMPLE_DURATION_MS,
  VALIDATION_SAMPLE_SAMPLE_RATE_HZ,
  buildAsrValidationWav,
} from './validation-sample'

describe('ASR validation sample', () => {
  it('produces a well-formed 1s 16 kHz mono PCM WAV', () => {
    const wav = buildAsrValidationWav()
    const frames = VALIDATION_SAMPLE_SAMPLE_RATE_HZ
      * (VALIDATION_SAMPLE_DURATION_MS / 1000)

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ')
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(VALIDATION_SAMPLE_SAMPLE_RATE_HZ)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(frames * 2)
    expect(wav.length).toBe(44 + frames * 2)
    // RIFF 长度字段必须是「文件长度 - 8」，写错会让部分网关直接拒收。
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
  })

  /**
   * 不能用全零静音：部分兼容网关会把全静音输入判成无效音频返回 4xx，
   * 那会让校验对一个可用端点报错。
   */
  it('carries real signal with faded edges rather than silence', () => {
    const wav = buildAsrValidationWav()
    const pcm = wav.subarray(44)
    let peak = 0
    for (let offset = 0; offset < pcm.length; offset += 2) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)))
    }
    expect(peak).toBeGreaterThan(0x2000)
    expect(pcm.readInt16LE(0)).toBe(0)
    expect(Math.abs(pcm.readInt16LE(pcm.length - 2))).toBeLessThan(0x0400)
  })

  it('is deterministic so the probe never drifts between runs', () => {
    expect(buildAsrValidationWav()).toEqual(buildAsrValidationWav())
  })
})
