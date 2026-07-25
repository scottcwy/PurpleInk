import 'server-only'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  type AiConfigDependencies,
  getAiConfigDependencies,
  type StepfunConfigFieldView,
  type StepfunConfigSource,
} from './config'

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
  primaryModel: 'gemini-3.6-flash',
  fastModel: 'gemini-3.1-flash-lite',
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function envOrDefault(field: GeminiConfigField): StepfunConfigFieldView {
  const value = nonEmpty(process.env[ENV_KEYS[field]])
  return value
    ? { value, source: 'env' }
    : { value: DEFAULTS[field], source: 'default' }
}

function configuredModel(
  provider: string | undefined,
  model: string | undefined,
  field: GeminiConfigField,
): StepfunConfigFieldView {
  return provider === 'gemini' && model
    ? { value: model, source: 'settings' }
    : envOrDefault(field)
}

export function resolveGeminiBaseUrl(): string {
  return envOrDefault('baseUrl').value
}

export async function getGeminiConfig(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<GeminiConfig> {
  const [storedKey, primary, fast] = await Promise.all([
    deps.credentials.loadSecret(LOCAL_WORKSPACE_ID, 'gemini'),
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'fabricate'),
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'project-plan'),
  ])
  return {
    apiKey: storedKey,
    baseUrl: resolveGeminiBaseUrl(),
    primaryModel: configuredModel(
      primary?.provider,
      primary?.model,
      'primaryModel',
    ).value,
    fastModel: configuredModel(fast?.provider, fast?.model, 'fastModel').value,
  }
}

export async function describeGeminiConfig(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<GeminiConfigView> {
  const [primary, fast] = await Promise.all([
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'fabricate'),
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'project-plan'),
  ])
  return {
    baseUrl: envOrDefault('baseUrl'),
    primaryModel: configuredModel(
      primary?.provider,
      primary?.model,
      'primaryModel',
    ),
    fastModel: configuredModel(fast?.provider, fast?.model, 'fastModel'),
  }
}

export interface GeminiSettingsInput {
  baseUrl?: string
  primaryModel?: string
  fastModel?: string
}

async function saveModelGroup(
  deps: AiConfigDependencies,
  input: {
    kinds: readonly ('project-plan' | 'shot-spec' | 'fabricate' | 'vision-qa')[]
    value: string
  },
): Promise<void> {
  const model = nonEmpty(input.value)
  await Promise.all(input.kinds.map((aiTaskKind) => model
    ? deps.modelRoutes.save({
        workspaceId: LOCAL_WORKSPACE_ID,
        aiTaskKind,
        provider: 'gemini',
        model,
      })
    : deps.modelRoutes.remove(LOCAL_WORKSPACE_ID, aiTaskKind)))
}

export async function saveGeminiSettings(
  input: GeminiSettingsInput,
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<void> {
  const requestedBaseUrl = nonEmpty(input.baseUrl)
  if (requestedBaseUrl && requestedBaseUrl !== DEFAULTS.baseUrl) {
    throw new Error(
      'Persisting a custom Gemini baseUrl is unsupported; use GEMINI_BASE_URL',
    )
  }
  const writes: Promise<void>[] = []
  if (input.primaryModel !== undefined) {
    writes.push(saveModelGroup(deps, {
      kinds: ['shot-spec', 'fabricate', 'vision-qa'],
      value: input.primaryModel,
    }))
  }
  if (input.fastModel !== undefined) {
    writes.push(saveModelGroup(deps, {
      kinds: ['project-plan'],
      value: input.fastModel,
    }))
  }
  await Promise.all(writes)
}

export async function saveGeminiApiKey(
  apiKey: string,
  verifiedAt = new Date(),
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<void> {
  await deps.credentials.save({
    workspaceId: LOCAL_WORKSPACE_ID,
    provider: 'gemini',
    secret: apiKey,
    verifiedAt,
  })
}

export type { StepfunConfigSource as GeminiConfigSource }
