import { readMp3FrameHeader } from './mp3-frame-header'
import { isWav, readWavHeader } from './wav-header'

export type AudioContainer = 'mp3' | 'wav'

export interface AudioStreamInfo {
  container: AudioContainer
  /** 容器头声明的原生采样率（真实字节的唯一依据）。 */
  sampleRateHz: number
  channels: number
}

/**
 * 从**真实字节**判定容器并读出原生流参数。
 *
 * 为什么不信 provider 声明的格式：TTS 路由可以在运行时切换（StepFun 返回 MP3，
 * MiMo 返回 WAV），而声明值散落在客户端、engine 描述和数据库路由里。真实事故是
 * WAV 字节被当成 MP3 解析——PCM 里恰好出现 0xFF 0xEx 时会解析出**伪造的采样率**
 * （实测 48000 / 44100 / 12000 / 22050，真实全为 24000），没撞上时则直接抛
 * 「找不到可验证的 MPEG audio 帧头」让整条链路失败。字节是唯一可信来源。
 *
 * WAV 必须先判：MP3 帧同步只是两个字节的位模式，在 PCM 数据里会随机命中。
 */
export function readAudioStreamInfo(bytes: Buffer): AudioStreamInfo {
  if (bytes.length === 0) throw new Error('音频字节为空，无法判定音频格式')
  if (isWav(bytes)) {
    const header = readWavHeader(bytes)
    return {
      container: 'wav',
      sampleRateHz: header.sampleRateHz,
      channels: header.channels,
    }
  }
  const header = readMp3FrameHeader(bytes)
  return {
    container: 'mp3',
    sampleRateHz: header.sampleRateHz,
    channels: header.channels,
  }
}

/** 只需要容器类型时的窄接口（例如把字节交给 ASR 时声明 MIME）。 */
export function detectAudioContainer(bytes: Buffer): AudioContainer {
  return readAudioStreamInfo(bytes).container
}
