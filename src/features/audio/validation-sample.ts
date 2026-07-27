/**
 * ASR 端点校验用的音频样本。
 *
 * 在内存里生成而不是提交一个 WAV fixture：仓库里的二进制 fixture 会悄悄和代码期望
 * 脱节（`docs/conventions/workflow-failure-patterns.md` 模式 E），而这段字节完全由
 * 参数决定，可以逐字段断言。
 *
 * 这是**合成音，不含语音内容**。因此 ASR 校验的判据只能是「HTTP 2xx 且响应体可被
 * schema 解析」，不能是「转写非空」——用一段无语义音频要求非空转写，等于把正常端点
 * 判成失败。设置页必须如实说明校验只确认端点、凭据与响应格式可用。
 */

export const VALIDATION_SAMPLE_SAMPLE_RATE_HZ = 16_000
export const VALIDATION_SAMPLE_DURATION_MS = 1_000

/**
 * 生成 16-bit 单声道 PCM 的 WAV。
 *
 * 用一段带包络的 220 Hz 正弦而不是全零静音：部分兼容网关会把全静音输入直接判成
 * 无效音频返回 4xx，那会让校验对一个可用端点报错。
 */
export function buildAsrValidationWav(
  durationMs: number = VALIDATION_SAMPLE_DURATION_MS,
  sampleRateHz: number = VALIDATION_SAMPLE_SAMPLE_RATE_HZ,
): Buffer {
  const frameCount = Math.round((durationMs / 1000) * sampleRateHz)
  const pcm = Buffer.alloc(frameCount * 2)
  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / frameCount
    // 首尾各 10% 做淡入淡出，避免爆音被判为损坏输入。
    const envelope = Math.min(1, progress / 0.1, (1 - progress) / 0.1)
    const sample = Math.sin((2 * Math.PI * 220 * index) / sampleRateHz)
    pcm.writeInt16LE(Math.round(sample * envelope * 0x4000), index * 2)
  }
  return Buffer.concat([wavHeader(pcm.length, sampleRateHz), pcm])
}

function wavHeader(dataBytes: number, sampleRateHz: number): Buffer {
  const channels = 1
  const bitsPerSample = 16
  const byteRate = sampleRateHz * channels * (bitsPerSample / 8)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRateHz, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}
