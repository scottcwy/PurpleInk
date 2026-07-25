import 'server-only'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { readMp3FrameHeader } from './mp3-frame-header'

export interface MeasuredAudio {
  /** 解码得到的单声道采样数（音频真实长度的唯一依据）。 */
  sampleCount: number
  /** 来自 MPEG 帧头的原生采样率。 */
  sampleRateHz: number
  durationMs: number
}

export type DecodeSampleBytes = (
  bytes: Buffer,
  sampleRateHz: number
) => Promise<number>

/**
 * 实测音频时长：解码真实字节并统计采样数，不使用 TTS 自报时长，也不按字数估算。
 *
 * 采样率取自 MPEG 帧头，采样数取自 ffmpeg 解码输出的 PCM 字节数，
 * 因此 durationMs 完全由字节内容决定（含编码器 gapless 裁剪）。
 */
export async function measureMp3(
  bytes: Buffer,
  decode: DecodeSampleBytes = decodePcmByteCount
): Promise<MeasuredAudio> {
  if (bytes.length === 0) throw new Error('音频字节为空，无法实测时长')
  const { sampleRateHz } = readMp3FrameHeader(bytes)
  const pcmBytes = await decode(bytes, sampleRateHz)
  const sampleCount = pcmBytes / 2
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error(`解码得到的 PCM 字节数无效：${pcmBytes}`)
  }
  return {
    sampleCount,
    sampleRateHz,
    durationMs: (sampleCount / sampleRateHz) * 1000,
  }
}

/** 以原生采样率解码为 16-bit 单声道 PCM 并统计字节数。 */
function decodePcmByteCount(bytes: Buffer, sampleRateHz: number): Promise<number> {
  if (!ffmpegPath) throw new Error('ffmpeg-static 未提供当前平台二进制')
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-map',
        '0:a:0',
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        '-ac',
        '1',
        '-ar',
        String(sampleRateHz),
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let total = 0
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) return resolve(total)
      reject(new Error(`ffmpeg 解码失败（exit ${code}）：${stderr.trim()}`))
    })
    // 解码器提前退出时 stdin 会 EPIPE；真实失败由 close 的非零退出码报告。
    child.stdin.on('error', () => {})
    child.stdin.end(bytes)
  })
}
