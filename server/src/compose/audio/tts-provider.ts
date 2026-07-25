// TTS 提供商抽象：Mock（测试）/ Azure / ElevenLabs。
// 零新依赖——Azure 与 ElevenLabs 均用 fetch 调用 REST API。
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { TtsConfig, WordTimestamp } from "./types.js"
import { logger } from "../../lib/logger.js"

// ── 公共接口 ────────────────────────────────────────────────────────────────

export interface TtsResult {
  audioBuffer: Buffer // 音频数据
  duration_s: number // 语音时长
  words: WordTimestamp[] // 词级时间戳（提供商支持时填充）
  format: string // e.g. "wav", "mp3"
}

export interface TtsProvider {
  name: string
  synthesize(
    text: string,
    options?: { voice?: string; language?: string },
  ): Promise<TtsResult>
}

// ── MockTtsProvider ──────────────────────────────────────────────────────────

/**
 * Mock TTS：生成一段指定时长的静音 WAV（PCM 16-bit, 24 kHz, mono）。
 * 用于无 API key 时的本地测试。
 */
export class MockTtsProvider implements TtsProvider {
  name = "mock"

  async synthesize(
    text: string,
    _options?: { voice?: string; language?: string },
  ): Promise<TtsResult> {
    // 按中文 ~4 字/秒、英文 ~3 词/秒估算时长，最少 1 秒
    const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const estimated = Math.max(1, cjkCount / 4 + wordCount / 3)
    const duration_s = Math.round(estimated * 10) / 10

    const sampleRate = 24_000
    const numSamples = Math.floor(sampleRate * duration_s)
    const buffer = Buffer.alloc(44 + numSamples * 2) // 16-bit PCM

    // WAV header
    buffer.write("RIFF", 0)
    buffer.writeUInt32LE(36 + numSamples * 2, 4)
    buffer.write("WAVE", 8)
    buffer.write("fmt ", 12)
    buffer.writeUInt32LE(16, 16) // chunk size
    buffer.writeUInt16LE(1, 20) // PCM
    buffer.writeUInt16LE(1, 22) // mono
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
    buffer.writeUInt16LE(2, 32) // block align
    buffer.writeUInt16LE(16, 34) // bits per sample
    // data chunk header at offset 36, samples already zeroed (silence)
    buffer.write("data", 36)
    buffer.writeUInt32LE(numSamples * 2, 40)

    logger.info("tts:mock_synthesized", { text: text.slice(0, 40), duration_s })
    return {
      audioBuffer: buffer,
      duration_s,
      words: [], // Mock 不产生词级时间戳，由上层 distributeWordTimestamps 补充
      format: "wav",
    }
  }
}

// ── AzureTtsProvider ─────────────────────────────────────────────────────────

/**
 * Azure Cognitive Services Speech API（REST）。
 * POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 *
 * 支持 SSML 格式，可通过 NBest 获取词级时间戳（WordBoundary 事件在 REST 模式下
 * 不直接返回；此处用字符均匀分配作为降级方案）。
 */
export class AzureTtsProvider implements TtsProvider {
  name = "azure"
  private apiKey: string
  private region: string

  constructor(config: TtsConfig) {
    if (!config.apiKey) throw new Error("Azure TTS: AZURE_TTS_KEY not configured")
    if (!config.region) throw new Error("Azure TTS: AZURE_TTS_REGION not configured")
    this.apiKey = config.apiKey
    this.region = config.region
  }

  async synthesize(
    text: string,
    options?: { voice?: string; language?: string },
  ): Promise<TtsResult> {
    const voice = options?.voice || "zh-CN-XiaoxiaoNeural"
    const lang = options?.language || "zh-CN"

    // 构建 SSML
    const ssml = `<speak version="1.0" xml:lang="${lang}" xmlns="http://www.w3.org/2001/10/synthesis">
  <voice name="${voice}">
    <prosody rate="1.0">${escapeXml(text)}</prosody>
  </voice>
</speak>`

    const endpoint = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
      },
      body: ssml,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      throw new Error(`Azure TTS ${res.status}: ${errText.slice(0, 300)}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)

    // 从 WAV header 读取时长
    const duration_s = readWavDuration(audioBuffer)

    logger.info("tts:azure_synthesized", { text: text.slice(0, 40), duration_s, voice })
    return { audioBuffer, duration_s, words: [], format: "wav" }
  }
}

// ── ElevenLabsTtsProvider ─────────────────────────────────────────────────────

/**
 * ElevenLabs TTS REST API。
 * POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 */
export class ElevenLabsTtsProvider implements TtsProvider {
  name = "elevenlabs"
  private apiKey: string

  constructor(config: TtsConfig) {
    if (!config.apiKey) throw new Error("ElevenLabs TTS: ELEVENLABS_API_KEY not configured")
    this.apiKey = config.apiKey
  }

  async synthesize(
    text: string,
    options?: { voice?: string; language?: string },
  ): Promise<TtsResult> {
    const voiceId = options?.voice || "21m00Tcm4TlvDq8ikWAM" // Rachel (English)

    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 300)}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)

    // MP3 时长估算：按 ~16 kbps 比特率近似（ElevenLabs 默认输出）
    const duration_s = Math.round((audioBuffer.length / 2000) * 10) / 10

    logger.info("tts:elevenlabs_synthesized", { text: text.slice(0, 40), duration_s, voiceId })
    return { audioBuffer, duration_s, words: [], format: "mp3" }
  }
}

// ── 工厂 ─────────────────────────────────────────────────────────────────────

export function createTtsProvider(config: TtsConfig): TtsProvider {
  switch (config.provider) {
    case "azure":
      return new AzureTtsProvider(config)
    case "elevenlabs":
      return new ElevenLabsTtsProvider(config)
    case "mock":
      return new MockTtsProvider()
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`)
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** 从 WAV buffer 的 header 读取时长（秒）。若 header 不完整则按文件大小估算。 */
function readWavDuration(buf: Buffer): number {
  if (buf.length < 44) return 0
  const byteRate = buf.readUInt32LE(28)
  const dataSize = buf.readUInt32LE(40)
  if (byteRate > 0 && dataSize > 0) return Math.round((dataSize / byteRate) * 100) / 100
  // 降级：假设 24kHz 16-bit mono → 48000 bytes/sec
  return Math.round(((buf.length - 44) / 48000) * 100) / 100
}

/** 将 TTS 结果写入音频文件，返回相对路径 */
export async function writeAudioFile(
  result: TtsResult,
  outputDir: string,
  subDir: string,
  filename: string,
): Promise<{ relPath: string; duration_s: number }> {
  const dir = join(outputDir, subDir)
  const { mkdir } = await import("node:fs/promises")
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, filename)
  await writeFile(filePath, result.audioBuffer)
  return { relPath: `${subDir}/${filename}`, duration_s: result.duration_s }
}
