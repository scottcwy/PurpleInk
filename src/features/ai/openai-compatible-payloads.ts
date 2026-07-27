/**
 * 自定义兼容端点三份 profile 的形状与 payload 解析。
 *
 * 本模块**不依赖数据库层**：解析「已落库的 JSON → 领域对象」是纯领域逻辑，
 * 和 drizzle、schema、连接池无关。放在这里让解析规则可以被单测直接覆盖，而不必把
 * 整套 DB 依赖图拖进测试进程——那会让启动边界类测试在满载下超时。
 * Postgres 读写留在 `openai-compatible-profile-store.ts` 与
 * `openai-compatible-audio-profile-store.ts`。
 */

export const TEXT_SCHEMA_VERSION = 2
export const AUDIO_SCHEMA_VERSION = 1

/**
 * 自定义兼容文本端点的配置。
 *
 * `visionModel` 与 `textModel` 分开：另外三家供应商都有独立的文本/视觉模型字段，
 * 只有这里曾经用一个 `defaultModel` 兼两职，导致把分镜验收路由到本端点时，
 * 用户填的文本模型会被当成视觉模型直到运行期才失败。留空表示该端点不提供视觉
 * 能力，视觉路由会在保存时被拒绝。
 */
export interface OpenAiCompatibleProfile {
  baseUrl: string
  textModel: string
  visionModel: string | null
}

/** TTS 的容器格式只开放这两种：`measureAudio` 只识别 MP3 帧头与 WAV fmt chunk。 */
export const AUDIO_FORMATS = ['mp3', 'wav'] as const
export type OpenAiCompatibleAudioFormat = (typeof AUDIO_FORMATS)[number]

export interface OpenAiCompatibleTtsProfile {
  baseUrl: string
  model: string
  /** 必填：音色表由端点决定，无法推断，也不提供默认值。 */
  voice: string
  audioFormat: OpenAiCompatibleAudioFormat
}

/**
 * `timestampMode` 与 `verification` 都不是用户输入，而是「校验并保存」那一次真实
 * 调用协商出来的结果。让用户直接填等于允许他谎报端点能力。
 */
export type OpenAiCompatibleTimestampMode = 'segment' | 'none'
export type OpenAiCompatibleAsrVerification = 'transcription' | 'credential-only'

export interface OpenAiCompatibleAsrProfile {
  baseUrl: string
  model: string
  timestampMode: OpenAiCompatibleTimestampMode
  verification: OpenAiCompatibleAsrVerification
}

/**
 * 解析已落库的文本 payload，兼容 v1。
 *
 * v1 只有一个 `defaultModel`，它当时同时服务文本与视觉。读成 `textModel` 是唯一
 * 诚实的映射：那个值只被 chat/completions 校验过，从未被证明能接受图像输入，
 * 所以 `visionModel` 保持 null 而不是拷贝一份。已有用户如果把分镜验收路由到本
 * 端点，会在下次保存路由时收到 422 并被要求显式填写视觉模型——这比继续拿一个
 * 未经视觉校验的模型去跑 QA 更可靠。
 *
 * 这段兼容读一旦回归，已配置用户的文本链路会静默变成「未配置」。
 */
export function parseOpenAiCompatibleProfilePayload(
  value: unknown,
): OpenAiCompatibleProfile | null {
  const record = asRecord(value)
  if (!record) return null
  const baseUrl = normalizeBaseUrl(record.baseUrl)
  if (!baseUrl) return null
  if (record.schemaVersion === 1) {
    const textModel = normalizeText(record.defaultModel)
    return textModel ? { baseUrl, textModel, visionModel: null } : null
  }
  if (record.schemaVersion !== TEXT_SCHEMA_VERSION) return null
  const textModel = normalizeText(record.textModel)
  return textModel
    ? { baseUrl, textModel, visionModel: normalizeText(record.visionModel) }
    : null
}

export function parseTtsProfilePayload(
  value: unknown,
): OpenAiCompatibleTtsProfile | null {
  const record = audioRecord(value)
  if (!record) return null
  const baseUrl = normalizeBaseUrl(record.baseUrl)
  const model = normalizeText(record.model)
  const voice = normalizeText(record.voice)
  const audioFormat = AUDIO_FORMATS.find((format) => format === record.audioFormat)
  return baseUrl && model && voice && audioFormat
    ? { baseUrl, model, voice, audioFormat }
    : null
}

export function parseAsrProfilePayload(
  value: unknown,
): OpenAiCompatibleAsrProfile | null {
  const record = audioRecord(value)
  if (!record) return null
  const baseUrl = normalizeBaseUrl(record.baseUrl)
  const model = normalizeText(record.model)
  if (!baseUrl || !model) return null
  // 时间戳能力与校验方式缺失时保守收敛：按「无时间戳、仅校验过凭据」处理，
  // 宁可让字幕整段对齐，也不能凭一条不完整的记录去请求 verbose_json。
  const timestampMode = record.timestampMode === 'segment' ? 'segment' : 'none'
  const verification = record.verification === 'transcription'
    ? 'transcription'
    : 'credential-only'
  return { baseUrl, model, timestampMode, verification }
}

export function normalizeBaseUrl(value: unknown): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return normalized.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function normalizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function audioRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  return record?.schemaVersion === AUDIO_SCHEMA_VERSION ? record : null
}
