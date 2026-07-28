import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { buildAsrValidationWav } from '@/lib/audio/wav-sample'
import type { ProviderCredentialStore } from '@/features/credentials'
import {
  AUDIO_FORMATS,
  normalizeBaseUrl,
  normalizeText,
  type OpenAiCompatibleAsrProfile,
  type OpenAiCompatibleAudioFormat,
  type OpenAiCompatibleTimestampMode,
  type OpenAiCompatibleTtsProfile,
} from './openai-compatible-payloads'
import type { OpenAiCompatibleAudioProfileStore } from './openai-compatible-audio-profile-store'

export const CUSTOM_TTS_PROVIDER = 'openai-compatible-tts' as const
export const CUSTOM_ASR_PROVIDER = 'openai-compatible-asr' as const

export interface TtsProfileInput {
  apiKey: string
  baseUrl: string
  model: string
  voice: string
  audioFormat: OpenAiCompatibleAudioFormat
}

export interface AsrProfileInput {
  apiKey: string
  baseUrl: string
  model: string
  /**
   * 转写校验被端点拒绝后，用户可选择只校验凭据。该路径**仍然先验证后保存**：
   * 需要 `GET {baseUrl}/models` 返回 2xx。
   */
  credentialOnly?: boolean
}

export interface AudioProfileDependencies {
  credentials: Pick<ProviderCredentialStore, 'save' | 'describe'>
  profileStore: OpenAiCompatibleAudioProfileStore
}

interface FieldView {
  value: string
  source: 'settings'
}

export interface TtsProfileView {
  configured: boolean
  verifiedAt: string | null
  baseUrl: FieldView | null
  model: FieldView | null
  voice: FieldView | null
  audioFormat: FieldView | null
}

export interface AsrProfileView {
  configured: boolean
  verifiedAt: string | null
  baseUrl: FieldView | null
  model: FieldView | null
  /** 端点是否返回分段时间戳。来自校验时的真实响应，不是用户输入。 */
  timestampMode: OpenAiCompatibleTimestampMode | null
  /** `credential-only` 表示转写能力未经验证，UI 必须如实说明。 */
  verification: OpenAiCompatibleAsrProfile['verification'] | null
}

export type TtsValidation = { ok: true } | { ok: false; status?: number }

export type AsrValidation =
  | { ok: true; timestampMode: OpenAiCompatibleTimestampMode; verification: 'transcription' }
  | { ok: true; timestampMode: 'none'; verification: 'credential-only' }
  | { ok: false; reason: 'transcription-rejected' | 'credential-rejected'; status?: number }

const PROBE_TIMEOUT_MS = 20_000

/** 极短文本：只为确认端点、凭据、模型、音色与容器格式被接受，不产出可用音频。 */
const TTS_PROBE_TEXT = '测试'

export async function validateTtsProfile(
  input: TtsProfileInput,
  fetcher: typeof fetch = fetch,
): Promise<TtsValidation> {
  const profile = parseTtsInput(input)
  const response = await probe(fetcher, `${profile.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey.trim()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: profile.model,
      input: TTS_PROBE_TEXT,
      voice: profile.voice,
      response_format: profile.audioFormat,
    }),
  })
  if (!response) return { ok: false }
  if (!response.ok) return { ok: false, status: response.status }
  const bytes = await response.arrayBuffer().catch(() => null)
  return bytes && bytes.byteLength > 0 ? { ok: true } : { ok: false }
}

/**
 * ASR 校验：先协商时间戳能力，再落库。
 *
 * 先试 `verbose_json` + 分段粒度；被拒则退 `json`。协商结果持久化后运行期不再探测。
 * 判据是 **HTTP 2xx 且响应体可被解析**，不是转写非空——样本是无语义合成音，
 * 要求非空转写会把正常端点判成失败。
 */
export async function validateAsrProfile(
  input: AsrProfileInput,
  fetcher: typeof fetch = fetch,
): Promise<AsrValidation> {
  const profile = parseAsrInput(input)
  const apiKey = input.apiKey.trim()
  if (input.credentialOnly === true) {
    const models = await probe(fetcher, `${profile.baseUrl}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
    })
    return models?.ok === true
      ? { ok: true, timestampMode: 'none', verification: 'credential-only' }
      : { ok: false, reason: 'credential-rejected', status: models?.status }
  }
  for (const timestampMode of ['segment', 'none'] as const) {
    const attempt = await transcribeProbe(
      fetcher,
      profile.baseUrl,
      apiKey,
      profile.model,
      timestampMode,
    )
    if (attempt.ok) return { ok: true, timestampMode, verification: 'transcription' }
    // 仅在「端点不接受该 response_format」时才降级重试；其余失败直接上报，
    // 否则一个凭据错误会被当成格式不支持而多打一次请求。
    if (attempt.status !== 400 && attempt.status !== 422) {
      return { ok: false, reason: 'transcription-rejected', status: attempt.status }
    }
  }
  return { ok: false, reason: 'transcription-rejected', status: 400 }
}

export async function saveTtsProfile(
  input: TtsProfileInput,
  dependencies: AudioProfileDependencies,
): Promise<void> {
  const profile = parseTtsInput(input)
  await dependencies.credentials.save({
    workspaceId: currentWorkspaceId(),
    provider: CUSTOM_TTS_PROVIDER,
    secret: input.apiKey.trim(),
    verifiedAt: new Date(),
  })
  await dependencies.profileStore.saveTts(currentWorkspaceId(), profile)
}

export async function saveAsrProfile(
  input: AsrProfileInput,
  negotiated: {
    timestampMode: OpenAiCompatibleTimestampMode
    verification: OpenAiCompatibleAsrProfile['verification']
  },
  dependencies: AudioProfileDependencies,
): Promise<void> {
  const profile = parseAsrInput(input)
  await dependencies.credentials.save({
    workspaceId: currentWorkspaceId(),
    provider: CUSTOM_ASR_PROVIDER,
    secret: input.apiKey.trim(),
    verifiedAt: new Date(),
  })
  await dependencies.profileStore.saveAsr(currentWorkspaceId(), {
    ...profile,
    ...negotiated,
  })
}

export async function describeTtsProfile(
  dependencies: AudioProfileDependencies,
): Promise<TtsProfileView> {
  const [credential, profile] = await Promise.all([
    dependencies.credentials.describe(currentWorkspaceId(), CUSTOM_TTS_PROVIDER),
    dependencies.profileStore.findTts(currentWorkspaceId()),
  ])
  return {
    configured: credential.configured && profile !== null,
    verifiedAt: credential.verifiedAt,
    baseUrl: field(profile?.baseUrl),
    model: field(profile?.model),
    voice: field(profile?.voice),
    audioFormat: field(profile?.audioFormat),
  }
}

export async function describeAsrProfile(
  dependencies: AudioProfileDependencies,
): Promise<AsrProfileView> {
  const [credential, profile] = await Promise.all([
    dependencies.credentials.describe(currentWorkspaceId(), CUSTOM_ASR_PROVIDER),
    dependencies.profileStore.findAsr(currentWorkspaceId()),
  ])
  return {
    configured: credential.configured && profile !== null,
    verifiedAt: credential.verifiedAt,
    baseUrl: field(profile?.baseUrl),
    model: field(profile?.model),
    timestampMode: profile?.timestampMode ?? null,
    verification: profile?.verification ?? null,
  }
}

async function transcribeProbe(
  fetcher: typeof fetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  timestampMode: OpenAiCompatibleTimestampMode,
): Promise<{ ok: boolean; status?: number }> {
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(buildAsrValidationWav())], { type: 'audio/wav' }),
    'probe.wav',
  )
  form.append('model', model)
  if (timestampMode === 'segment') {
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
  } else {
    form.append('response_format', 'json')
  }
  const response = await probe(fetcher, `${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    // 不设 content-type：boundary 必须由 FormData 生成。
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!response) return { ok: false }
  if (!response.ok) return { ok: false, status: response.status }
  // 响应体必须是可解析 JSON；转写内容可以为空（样本是无语义合成音）。
  const parsed = await response.json().catch(() => null)
  return parsed !== null && typeof parsed === 'object'
    ? { ok: true }
    : { ok: false }
}

async function probe(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch {
    return null
  }
}

function field(value: string | null | undefined): FieldView | null {
  return value ? { value, source: 'settings' } : null
}

function parseTtsInput(input: TtsProfileInput): OpenAiCompatibleTtsProfile {
  const apiKey = normalizeText(input.apiKey)
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const model = normalizeText(input.model)
  const voice = normalizeText(input.voice)
  const audioFormat = AUDIO_FORMATS.find((format) => format === input.audioFormat)
  if (!apiKey) throw new Error('自定义兼容 TTS API Key 不能为空')
  if (!baseUrl) throw new Error('自定义兼容 TTS 端点必须是 http(s) URL')
  if (!model) throw new Error('自定义兼容 TTS 模型不能为空')
  if (!voice) throw new Error('自定义兼容 TTS 音色不能为空')
  if (!audioFormat) throw new Error('自定义兼容 TTS 音频格式只支持 mp3 或 wav')
  return { baseUrl, model, voice, audioFormat }
}

function parseAsrInput(
  input: AsrProfileInput,
): Pick<OpenAiCompatibleAsrProfile, 'baseUrl' | 'model'> {
  const apiKey = normalizeText(input.apiKey)
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const model = normalizeText(input.model)
  if (!apiKey) throw new Error('自定义兼容 ASR API Key 不能为空')
  if (!baseUrl) throw new Error('自定义兼容 ASR 端点必须是 http(s) URL')
  if (!model) throw new Error('自定义兼容 ASR 模型不能为空')
  return { baseUrl, model }
}
