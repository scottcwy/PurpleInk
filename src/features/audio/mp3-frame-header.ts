/**
 * MPEG audio 帧头解析（纯函数，不依赖运行时或外部进程）。
 *
 * 只用于从**真实字节**读出采样率等流参数，供时长实测换算使用。
 * 不从帧头推算时长：帧计数会把编码器 delay/padding 也算进去，
 * 与实际可听时长有偏差，时长必须由解码后的采样数决定（见 measure.ts）。
 */

const SAMPLE_RATES: readonly (readonly number[] | null)[] = [
  [11025, 12000, 8000], // MPEG 2.5
  null, // reserved
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
]

const BITRATES_MPEG1: Readonly<Record<number, readonly number[]>> = {
  3: [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  1: [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
}

const BITRATES_MPEG2: Readonly<Record<number, readonly number[]>> = {
  3: [32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  1: [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}

export interface Mp3FrameHeader {
  /** 首个有效帧在字节流中的偏移。 */
  offset: number
  sampleRateHz: number
  channels: number
  /** 该帧的字节长度，用于校验下一帧同步。 */
  frameLength: number
}

/** 读取首个可验证的 MPEG audio 帧头；无法确认时抛错而不猜测。 */
export function readMp3FrameHeader(bytes: Buffer): Mp3FrameHeader {
  const start = skipId3v2(bytes)
  for (let offset = start; offset + 4 <= bytes.length; offset += 1) {
    const header = parseFrameHeader(bytes, offset)
    if (!header) continue
    if (isFollowedBySync(bytes, header)) return header
  }
  throw new Error('音频字节中找不到可验证的 MPEG audio 帧头')
}

function skipId3v2(bytes: Buffer): number {
  if (bytes.length < 10 || bytes.toString('latin1', 0, 3) !== 'ID3') return 0
  const size =
    ((bytes[6] ?? 0) << 21) |
    ((bytes[7] ?? 0) << 14) |
    ((bytes[8] ?? 0) << 7) |
    (bytes[9] ?? 0)
  const end = 10 + size
  return end < bytes.length ? end : 0
}

function parseFrameHeader(bytes: Buffer, offset: number): Mp3FrameHeader | null {
  const byte0 = bytes[offset]
  const byte1 = bytes[offset + 1]
  const byte2 = bytes[offset + 2]
  const byte3 = bytes[offset + 3]
  if (
    byte0 === undefined ||
    byte1 === undefined ||
    byte2 === undefined ||
    byte3 === undefined
  ) {
    return null
  }
  if (byte0 !== 0xff || (byte1 & 0xe0) !== 0xe0) return null
  const version = (byte1 >> 3) & 0x03
  const layer = (byte1 >> 1) & 0x03
  const bitrateIndex = (byte2 >> 4) & 0x0f
  const rateIndex = (byte2 >> 2) & 0x03
  const padding = (byte2 >> 1) & 0x01
  const channelMode = (byte3 >> 6) & 0x03
  const rates = SAMPLE_RATES[version]
  if (!rates || layer === 0 || rateIndex === 3) return null
  if (bitrateIndex === 0 || bitrateIndex === 0x0f) return null
  const sampleRateHz = rates[rateIndex]
  const table = version === 3 ? BITRATES_MPEG1 : BITRATES_MPEG2
  const bitrateKbps = table[layer]?.[bitrateIndex - 1]
  if (sampleRateHz === undefined || bitrateKbps === undefined) return null
  return {
    offset,
    sampleRateHz,
    channels: channelMode === 3 ? 1 : 2,
    frameLength: frameLength({
      layer,
      version,
      bitrateBps: bitrateKbps * 1000,
      sampleRateHz,
      padding,
    }),
  }
}

function frameLength(input: {
  layer: number
  version: number
  bitrateBps: number
  sampleRateHz: number
  padding: number
}): number {
  if (input.layer === 3) {
    return (
      (Math.floor((12 * input.bitrateBps) / input.sampleRateHz) + input.padding) * 4
    )
  }
  const samplesPerFrame = input.layer === 2 || input.version === 3 ? 1152 : 576
  return (
    Math.floor((samplesPerFrame / 8) * (input.bitrateBps / input.sampleRateHz)) +
    input.padding
  )
}

/** 下一帧必须仍然同步，否则当前 0xFF 只是数据字节的巧合。 */
function isFollowedBySync(bytes: Buffer, header: Mp3FrameHeader): boolean {
  const next = header.offset + header.frameLength
  if (next + 2 > bytes.length) return next === bytes.length
  const byte0 = bytes[next]
  const byte1 = bytes[next + 1]
  return byte0 === 0xff && byte1 !== undefined && (byte1 & 0xe0) === 0xe0
}
