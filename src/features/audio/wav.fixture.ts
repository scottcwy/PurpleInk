/**
 * 测试用 RIFF/WAVE 字节构造器（16-bit 单声道 PCM）。
 *
 * 真实 TTS 的 WAV 只有采样率、声道与 PCM 数据参与实测，这里构造的是同形状的
 * 最小合法容器，避免把二进制样本文件提交进仓库。
 */
export function wavBytes(input: {
  sampleRateHz: number
  sampleCount: number
  channels?: number
  /** 填进 PCM 数据区的字节，默认 0xFF——恰好是 MPEG 同步字的第一个字节，
   *  用于证明 WAV 不会被误判成 MP3。 */
  fill?: number
}): Buffer {
  const channels = input.channels ?? 1
  const bitsPerSample = 16
  const blockAlign = (channels * bitsPerSample) / 8
  const dataBytes = input.sampleCount * blockAlign
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(input.sampleRateHz, 24)
  header.writeUInt32LE(input.sampleRateHz * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(dataBytes, 40)
  return Buffer.concat([header, Buffer.alloc(dataBytes, input.fill ?? 0xff)])
}
