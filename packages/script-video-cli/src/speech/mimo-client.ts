import { requestChatCompletion, type ChatTransportConfig, type ChatTransportDependencies } from '../ai/chat-transport'
import { AiProviderError } from '../ai/provider-error'
import { SafeCliError } from '../safe-error'

export const MIMO_DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1' as const
export const MIMO_TTS_MODEL = 'mimo-v2.5-tts' as const
export const MIMO_VOICE_CLONE_MODEL = 'mimo-v2.5-tts-voiceclone' as const
export const MIMO_ASR_MODEL = 'mimo-v2.5-asr' as const
export const MAX_AUDIO_BASE64_BYTES = 10 * 1024 * 1024

export type SpeechAudioMimeType = 'audio/wav' | 'audio/mpeg' | 'audio/mp3'
export type AsrLanguage = 'auto' | 'zh' | 'en'

export interface MimoSpeechConfig extends Omit<ChatTransportConfig, 'baseUrl'> {
  baseUrl?: string
  ttsModel: string
  voiceCloneModel?: string
  asrModel: string
}

export interface SpeechSynthesisInput {
  text: string
  style: string
  voice?: string
  voiceSample?: { bytes: Uint8Array; mimeType: SpeechAudioMimeType }
  signal?: AbortSignal
}

export interface SpeechTranscriptionInput {
  audio: Uint8Array
  mimeType: SpeechAudioMimeType
  language?: AsrLanguage
  signal?: AbortSignal
}

export interface MimoSpeechClient {
  synthesize(input: SpeechSynthesisInput): Promise<{ audio: Uint8Array; mimeType: 'audio/wav' }>
  transcribe(input: SpeechTranscriptionInput): Promise<{ text: string }>
}

export interface AudioSampleProjection {
  base64: string
  dataUrl: string
  mimeType: SpeechAudioMimeType
}

export function createMimoSpeechClient(
  config: MimoSpeechConfig,
  dependencies: ChatTransportDependencies = {},
): MimoSpeechClient {
  const normalized = normalizeSpeechConfig(config)
  return {
    synthesize: (input) => synthesize(normalized, input, dependencies),
    transcribe: (input) => transcribe(normalized, input, dependencies),
  }
}

export function assertSupportedAudioSample(bytes: Uint8Array, mimeType: SpeechAudioMimeType): AudioSampleProjection {
  if (mimeType !== 'audio/wav' && mimeType !== 'audio/mpeg' && mimeType !== 'audio/mp3') {
    throw new SafeCliError('VOICE_FORMAT_UNSUPPORTED', '样音只支持 WAV 或 MP3。', false, 400)
  }
  if (bytes.byteLength === 0) throw new SafeCliError('AUDIO_SAMPLE_EMPTY', '音频样本为空。', false, 400)
  const base64 = Buffer.from(bytes).toString('base64')
  if (Buffer.byteLength(base64, 'ascii') > MAX_AUDIO_BASE64_BYTES) {
    throw new SafeCliError('AUDIO_SAMPLE_TOO_LARGE', '音频样本 Base64 后不能超过 10 MiB。', false, 413)
  }
  return { base64, dataUrl: `data:${mimeType};base64,${base64}`, mimeType }
}

interface NormalizedSpeechConfig extends MimoSpeechConfig {
  baseUrl: string
  voiceCloneModel: string
}

function normalizeSpeechConfig(config: MimoSpeechConfig): NormalizedSpeechConfig {
  if (config.ttsModel !== MIMO_TTS_MODEL || config.asrModel !== MIMO_ASR_MODEL) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'MiMo speech model 配置无效')
  }
  const voiceCloneModel = config.voiceCloneModel ?? MIMO_VOICE_CLONE_MODEL
  if (voiceCloneModel !== MIMO_VOICE_CLONE_MODEL) {
    throw new AiProviderError('AI_CONFIG_INVALID', 'MiMo voice clone model 配置无效')
  }
  return { ...config, baseUrl: config.baseUrl?.trim() || MIMO_DEFAULT_BASE_URL, voiceCloneModel }
}

async function synthesize(
  config: NormalizedSpeechConfig,
  input: SpeechSynthesisInput,
  dependencies: ChatTransportDependencies,
): Promise<{ audio: Uint8Array; mimeType: 'audio/wav' }> {
  const text = input.text.trim()
  const style = input.style.trim()
  if (!text || !style) throw new AiProviderError('AI_CONFIG_INVALID', 'TTS 文本或风格指令为空')
  const sample = input.voiceSample
    ? assertSupportedAudioSample(input.voiceSample.bytes, input.voiceSample.mimeType)
    : undefined
  const payload = await requestChatCompletion(
    config,
    {
      model: sample ? config.voiceCloneModel : config.ttsModel,
      messages: [
        { role: 'user', content: style },
        { role: 'assistant', content: text },
      ],
      audio: { format: 'wav', voice: (sample?.dataUrl ?? input.voice?.trim()) || 'mimo_default' },
    },
    { ...dependencies, signal: input.signal },
  )
  const data = extractAudioData(payload)
  const audio = decodeStrictBase64(data)
  if (!isWav(audio)) throw new AiProviderError('AI_OUTPUT_INVALID', 'TTS 返回的 WAV 无效')
  return { audio, mimeType: 'audio/wav' }
}

async function transcribe(
  config: NormalizedSpeechConfig,
  input: SpeechTranscriptionInput,
  dependencies: ChatTransportDependencies,
): Promise<{ text: string }> {
  const sample = assertSupportedAudioSample(input.audio, input.mimeType)
  const language = input.language ?? 'auto'
  if (language !== 'auto' && language !== 'zh' && language !== 'en') {
    throw new AiProviderError('AI_CONFIG_INVALID', 'ASR language 配置无效')
  }
  const payload = await requestChatCompletion(
    config,
    {
      model: config.asrModel,
      messages: [
        {
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: sample.dataUrl } }],
        },
      ],
      asr_options: { language },
    },
    { ...dependencies, signal: input.signal },
  )
  const text = extractText(payload)
  if (!text) throw new AiProviderError('AI_OUTPUT_INVALID', 'ASR 返回文本为空')
  return { text }
}

function extractAudioData(value: unknown): string {
  if (!isRecord(value)) throw new AiProviderError('AI_OUTPUT_INVALID', 'TTS 返回结构无效')
  const choices = value.choices
  if (!Array.isArray(choices) || !isRecord(choices[0])) {
    throw new AiProviderError('AI_OUTPUT_INVALID', 'TTS 返回结构无效')
  }
  const message = choices[0].message
  if (!isRecord(message) || !isRecord(message.audio) || typeof message.audio.data !== 'string') {
    throw new AiProviderError('AI_OUTPUT_INVALID', 'TTS 返回音频为空')
  }
  return message.audio.data
}

function extractText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) return ''
  const message = value.choices[0].message
  return isRecord(message) && typeof message.content === 'string' ? message.content.trim() : ''
}

function decodeStrictBase64(value: string): Uint8Array {
  const compact = value.trim()
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) {
    throw new AiProviderError('AI_OUTPUT_INVALID', 'TTS 返回音频编码无效')
  }
  const decoded = Buffer.from(compact, 'base64')
  if (decoded.byteLength === 0 || decoded.toString('base64') !== compact) {
    throw new AiProviderError('AI_OUTPUT_INVALID', 'TTS 返回音频编码无效')
  }
  return decoded
}

function isWav(value: Uint8Array): boolean {
  const buffer = Buffer.from(value)
  return (
    buffer.byteLength >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
