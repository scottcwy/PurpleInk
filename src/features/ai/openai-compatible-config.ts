import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { ProviderCredentialStore } from '@/features/credentials'
import {
  normalizeBaseUrl,
  normalizeText,
  type OpenAiCompatibleProfile,
} from './openai-compatible-payloads'
import type { OpenAiCompatibleProfileStore } from './openai-compatible-profile-store'

export const CUSTOM_OPENAI_PROVIDER = 'openai-compatible' as const

export interface OpenAiCompatibleProfileInput {
  apiKey: string
  baseUrl: string
  textModel: string
  /** 留空表示该端点不提供视觉能力；视觉路由会在保存时被拒绝。 */
  visionModel?: string
}

export interface OpenAiCompatibleDependencies {
  credentials: Pick<ProviderCredentialStore, 'save' | 'describe'>
  profileStore: OpenAiCompatibleProfileStore
}

interface FieldView {
  value: string
  source: 'settings'
}

export interface OpenAiCompatibleProfileView {
  configured: boolean
  verifiedAt: string | null
  baseUrl: FieldView | null
  textModel: FieldView | null
  visionModel: FieldView | null
}

export type OpenAiCompatibleValidation =
  | { ok: true }
  | { ok: false; field: 'textModel' | 'visionModel'; status?: number }

export async function saveOpenAiCompatibleProfile(
  input: OpenAiCompatibleProfileInput,
  dependencies: OpenAiCompatibleDependencies,
): Promise<void> {
  const profile = parseInput(input)
  await dependencies.credentials.save({
    workspaceId: currentWorkspaceId(),
    provider: CUSTOM_OPENAI_PROVIDER,
    secret: input.apiKey.trim(),
    verifiedAt: new Date(),
  })
  await dependencies.profileStore.save(currentWorkspaceId(), profile)
}

export async function describeOpenAiCompatibleProfile(
  dependencies: OpenAiCompatibleDependencies,
): Promise<OpenAiCompatibleProfileView> {
  const [credential, profile] = await Promise.all([
    dependencies.credentials.describe(currentWorkspaceId(), CUSTOM_OPENAI_PROVIDER),
    dependencies.profileStore.find(currentWorkspaceId()),
  ])
  return {
    configured: credential.configured && profile !== null,
    verifiedAt: credential.verifiedAt,
    baseUrl: field(profile?.baseUrl),
    textModel: field(profile?.textModel),
    visionModel: field(profile?.visionModel),
  }
}

/**
 * 校验文本模型，以及在填写了视觉模型时**单独**校验它。
 *
 * 视觉模型必须用真实图像输入探测：只发文本请求只能证明模型 ID 存在，无法证明它
 * 接受图像。分镜验收正是靠图像输入工作的，把一个纯文本模型存成视觉模型只会在
 * FINALIZE 阶段才炸，而那时设置页早已显示「已配置」。
 */
export async function validateOpenAiCompatibleProfile(
  input: OpenAiCompatibleProfileInput,
  fetcher: typeof fetch = fetch,
): Promise<OpenAiCompatibleValidation> {
  const profile = parseInput(input)
  const apiKey = input.apiKey.trim()
  const text = await probe(
    fetcher,
    profile.baseUrl,
    apiKey,
    { model: profile.textModel, messages: [{ role: 'user', content: 'ping' }] },
  )
  if (!text.ok) return { ok: false, field: 'textModel', status: text.status }
  if (!profile.visionModel) return { ok: true }
  const vision = await probe(fetcher, profile.baseUrl, apiKey, {
    model: profile.visionModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'ping' },
        { type: 'image_url', image_url: { url: PROBE_IMAGE_DATA_URL } },
      ],
    }],
  })
  return vision.ok
    ? { ok: true }
    : { ok: false, field: 'visionModel', status: vision.status }
}

export function parseOpenAiCompatibleProfile(
  value: Pick<OpenAiCompatibleProfileInput, 'baseUrl' | 'textModel' | 'visionModel'>,
): OpenAiCompatibleProfile {
  return parseInput({ ...value, apiKey: 'unused' })
}

/**
 * 8×8 全黑 PNG，69 字节，由 IHDR/IDAT/IEND 三个 chunk 组成的合法文件。
 *
 * 用于确认视觉模型真的接受 `image_url` 输入：纯文本模型的兼容网关会以 4xx 拒绝
 * 这类请求，这正是需要的信号。
 */
const PROBE_IMAGE_DATA_URL = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAAAAADhZOFXAAAADElEQVR4nGNgoA4AAABIAAEu'
  + 'uDx+AAAAAElFTkSuQmCC'

const PROBE_TIMEOUT_MS = 15_000

async function probe(
  fetcher: typeof fetch,
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number }> {
  try {
    const response = await fetcher(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...body, max_tokens: 1 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return response.ok ? { ok: true } : { ok: false, status: response.status }
  } catch {
    return { ok: false }
  }
}

function field(value: string | null | undefined): FieldView | null {
  return value ? { value, source: 'settings' } : null
}

function parseInput(
  input: OpenAiCompatibleProfileInput,
): OpenAiCompatibleProfile {
  const apiKey = normalizeText(input.apiKey)
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const textModel = normalizeText(input.textModel)
  if (!apiKey) throw new Error('OpenAI 兼容 API Key 不能为空')
  if (!baseUrl) throw new Error('OpenAI 兼容端点必须是 http(s) URL')
  if (!textModel) throw new Error('OpenAI 兼容文本模型不能为空')
  return { baseUrl, textModel, visionModel: normalizeText(input.visionModel) }
}
