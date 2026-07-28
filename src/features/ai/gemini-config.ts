import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  type AiConfigDependencies,
  getAiConfigDependencies,
  resolveProviderApiKey,
  type StepfunConfigFieldView,
  type StepfunConfigSource,
} from './config'
import { RouteContractError } from './route-contract-error'

export type GeminiConfigField = 'baseUrl' | 'primaryModel' | 'fastModel'

export interface GeminiConfig {
  apiKey: string | null
  baseUrl: string
  primaryModel: string
  fastModel: string
}

export type GeminiConfigView = Record<GeminiConfigField, StepfunConfigFieldView>

const ENV_KEYS: Record<GeminiConfigField, string> = {
  baseUrl: 'GEMINI_BASE_URL',
  primaryModel: 'GEMINI_PRIMARY_MODEL',
  fastModel: 'GEMINI_FAST_MODEL',
}

const DEFAULTS: Record<GeminiConfigField, string> = {
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  primaryModel: 'gemini-3.1-flash-lite',
  fastModel: 'gemini-3.1-flash-lite',
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function envOrDefault(field: GeminiConfigField): StepfunConfigFieldView {
  const value = field === 'baseUrl' ? nonEmpty(process.env[ENV_KEYS[field]]) : null
  return value
    ? { value, source: 'env' }
    : { value: DEFAULTS[field], source: 'default' }
}

export function resolveGeminiBaseUrl(): string {
  return envOrDefault('baseUrl').value
}

export async function getGeminiConfig(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<GeminiConfig> {
  return {
    apiKey: await resolveProviderApiKey('gemini', deps),
    baseUrl: resolveGeminiBaseUrl(),
    primaryModel: DEFAULTS.primaryModel,
    fastModel: DEFAULTS.fastModel,
  }
}

export async function describeGeminiConfig(
  _deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<GeminiConfigView> {
  return {
    baseUrl: envOrDefault('baseUrl'),
    primaryModel: envOrDefault('primaryModel'),
    fastModel: envOrDefault('fastModel'),
  }
}

export interface GeminiSettingsInput {
  baseUrl?: string
  primaryModel?: string
  fastModel?: string
}

export async function saveGeminiSettings(
  input: GeminiSettingsInput,
  _deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<void> {
  const requestedBaseUrl = nonEmpty(input.baseUrl)
  if (requestedBaseUrl && requestedBaseUrl !== DEFAULTS.baseUrl) {
    throw new Error(
      'Persisting a custom Gemini baseUrl is unsupported; use GEMINI_BASE_URL',
    )
  }
  if (input.primaryModel !== undefined || input.fastModel !== undefined) {
    throw new RouteContractError('Gemini 托管模型由服务端目录管理，不接受设置写入')
  }
}

export async function saveGeminiApiKey(
  apiKey: string,
  verifiedAt = new Date(),
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<void> {
  await deps.credentials.save({
    workspaceId: currentWorkspaceId(),
    provider: 'gemini',
    secret: apiKey,
    verifiedAt,
  })
}

export type { StepfunConfigSource as GeminiConfigSource }
