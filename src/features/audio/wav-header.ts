/**
 * RIFF/WAVE 头解析（纯函数，不依赖运行时或外部进程）。
 *
 * 与 `mp3-frame-header.ts` 对称：只从**真实字节**读出流参数，供时长实测换算使用。
 * 不从 `data` chunk 长度直接推时长，时长仍由解码后的采样数决定（见 `measure.ts`），
 * 这样压缩型 WAV（如 ADPCM）也不会算错。
 */

export interface WavHeader {
  sampleRateHz: number
  channels: number
  bitsPerSample: number
  /** `data` chunk 的字节长度；缺失时为 0。 */
  dataBytes: number
}

const RIFF = 'RIFF'
const WAVE = 'WAVE'
const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

/** 字节是否为 RIFF/WAVE 容器。只看魔数，不信任任何外部声明。 */
export function isWav(bytes: Buffer): boolean {
  return (
    bytes.length >= HEADER_BYTES &&
    bytes.toString('latin1', 0, 4) === RIFF &&
    bytes.toString('latin1', 8, 12) === WAVE
  )
}

/** 读取 `fmt ` chunk；不是合法 WAV 或缺少必需字段时抛错而不猜测。 */
export function readWavHeader(bytes: Buffer): WavHeader {
  if (!isWav(bytes)) throw new Error('音频字节不是 RIFF/WAVE 容器')
  let cursor = HEADER_BYTES
  let format: Omit<WavHeader, 'dataBytes'> | undefined
  let dataBytes = 0
  while (cursor + CHUNK_HEADER_BYTES <= bytes.length) {
    const id = bytes.toString('latin1', cursor, cursor + 4)
    const size = bytes.readUInt32LE(cursor + 4)
    const body = cursor + CHUNK_HEADER_BYTES
    if (id === 'fmt ') format = readFormatChunk(bytes, body, size)
    if (id === 'data') dataBytes = Math.min(size, bytes.length - body)
    // chunk 按偶数字节对齐（RIFF 规范），奇数长度后有一个填充字节。
    cursor = body + size + (size % 2)
  }
  if (!format) throw new Error('WAV 字节中找不到 fmt chunk')
  return { ...format, dataBytes }
}

function readFormatChunk(
  bytes: Buffer,
  offset: number,
  size: number
): Omit<WavHeader, 'dataBytes'> {
  if (size < 16 || offset + 16 > bytes.length) {
    throw new Error('WAV 的 fmt chunk 长度不足')
  }
  const channels = bytes.readUInt16LE(offset + 2)
  const sampleRateHz = bytes.readUInt32LE(offset + 4)
  const bitsPerSample = bytes.readUInt16LE(offset + 14)
  if (sampleRateHz < 8000 || sampleRateHz > 384_000) {
    throw new Error(`WAV 采样率不在可用范围：${sampleRateHz}`)
  }
  if (channels < 1 || channels > 8) {
    throw new Error(`WAV 声道数不在可用范围：${channels}`)
  }
  return { sampleRateHz, channels, bitsPerSample }
}
