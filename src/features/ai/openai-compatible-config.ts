import 'server-only'
import type { ProviderCredentialStore } from '@/features/credentials'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  normalizeBaseUrl,
  normalizeText,
  type OpenAiCompatibleProfile,
  type OpenAiCompatibleProfileStore,
} from './openai-compatible-profile-store'

export const CUSTOM_OPENAI_PROVIDER = 'openai-compatible' as const

export interface OpenAiCompatibleProfileInput {
  apiKey: string
  baseUrl: string
  defaultModel: string
}

export interface OpenAiCompatibleDependencies {
  credentials: Pick<ProviderCredentialStore, 'save' | 'describe'>
  profileStore: OpenAiCompatibleProfileStore
}

export interface OpenAiCompatibleProfileView {
  configured: boolean
  verifiedAt: string | null
  baseUrl: { value: string; source: 'settings' } | null
  defaultModel: { value: string; source: 'settings' } | null
}

export async function saveOpenAiCompatibleProfile(
  input: OpenAiCompatibleProfileInput,
  dependencies: OpenAiCompatibleDependencies,
): Promise<void> {
  const profile = parseInput(input)
  await dependencies.credentials.save({
    workspaceId: LOCAL_WORKSPACE_ID,
    provider: CUSTOM_OPENAI_PROVIDER,
    secret: input.apiKey.trim(),
    verifiedAt: new Date(),
  })
  await dependencies.profileStore.save(LOCAL_WORKSPACE_ID, profile)
}

export async function describeOpenAiCompatibleProfile(
  dependencies: OpenAiCompatibleDependencies,
): Promise<OpenAiCompatibleProfileView> {
  const [credential, profile] = await Promise.all([
    dependencies.credentials.describe(LOCAL_WORKSPACE_ID, CUSTOM_OPENAI_PROVIDER),
    dependencies.profileStore.find(LOCAL_WORKSPACE_ID),
  ])
  return {
    configured: credential.configured && profile !== null,
    verifiedAt: credential.verifiedAt,
    baseUrl: profile ? { value: profile.baseUrl, source: 'settings' } : null,
    defaultModel: profile ? { value: profile.defaultModel, source: 'settings' } : null,
  }
}

export async function validateOpenAiCompatibleProfile(
  input: OpenAiCompatibleProfileInput,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; status?: number }> {
  const profile = parseInput(input)
  try {
    const response = await fetcher(`${profile.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: profile.defaultModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    return response.ok ? { ok: true } : { ok: false, status: response.status }
  } catch {
    return { ok: false }
  }
}

export function parseOpenAiCompatibleProfile(
  value: Pick<OpenAiCompatibleProfileInput, 'baseUrl' | 'defaultModel'>,
): OpenAiCompatibleProfile {
  return parseInput({ ...value, apiKey: 'unused' })
}

function parseInput(input: OpenAiCompatibleProfileInput): OpenAiCompatibleProfile {
  const apiKey = normalizeText(input.apiKey)
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const defaultModel = normalizeText(input.defaultModel)
  if (!apiKey) throw new Error('OpenAI 兼容 API Key 不能为空')
  if (!baseUrl) throw new Error('OpenAI 兼容端点必须是 http(s) URL')
  if (!defaultModel) throw new Error('OpenAI 兼容默认模型不能为空')
  return { baseUrl, defaultModel }
}
