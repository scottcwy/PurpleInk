import 'server-only'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { readAudioStreamInfo, type AudioContainer } from './audio-format'

export interface MeasuredAudio {
  /** 解码得到的单声道采样数（音频真实长度的唯一依据）。 */
  sampleCount: number
  /** 来自容器头的原生采样率。 */
  sampleRateHz: number
  durationMs: number
  /** 由真实字节判定的容器类型。 */
  container: AudioContainer
}

export type DecodeSampleBytes = (
  bytes: Buffer,
  sampleRateHz: number
) => Promise<number>

/**
 * 实测音频时长：解码真实字节并统计采样数，不使用 TTS 自报时长，也不按字数估算。
 *
 * 容器与采样率都由真实字节判定（MP3 读帧头，WAV 读 fmt chunk），采样数取自
 * ffmpeg 解码输出的 PCM 字节数，因此 durationMs 完全由字节内容决定
 * （含编码器 gapless 裁剪）。TTS 供应商声明的格式与时长都不参与。
 */
export async function measureAudio(
  bytes: Buffer,
  decode: DecodeSampleBytes = decodePcmByteCount
): Promise<MeasuredAudio> {
  if (bytes.length === 0) throw new Error('音频字节为空，无法实测时长')
  const { container, sampleRateHz } = readAudioStreamInfo(bytes)
  const pcmBytes = await decode(bytes, sampleRateHz)
  const sampleCount = pcmBytes / 2
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error(`解码得到的 PCM 字节数无效：${pcmBytes}`)
  }
  return {
    sampleCount,
    sampleRateHz,
    durationMs: (sampleCount / sampleRateHz) * 1000,
    container,
  }
}

/** 以原生采样率解码为 16-bit 单声道 PCM 并统计字节数。 */
function decodePcmByteCount(bytes: Buffer, sampleRateHz: number): Promise<number> {
  const executable = ffmpegPath
  if (!executable) throw new Error('ffmpeg-static 未提供当前平台二进制')
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
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
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let total = 0
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      reject(new Error(`ffmpeg 启动失败：${error.message}`, { cause: error }))
    })
    child.once('close', (code) => {
      if (code === 0) resolve(total)
      else reject(new Error(`ffmpeg 解码失败（exit ${String(code)}）：${stderr.trim()}`))
    })
    // 解码器提前退出时 stdin 会 EPIPE；真实失败由 close 的非零退出码报告。
    child.stdin.on('error', () => {})
    child.stdin.end(bytes)
  })
}
