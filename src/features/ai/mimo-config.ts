import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { AiTaskKind, MediaTaskKind } from '@/features/routing'
import {
  type AiConfigDependencies,
  getAiConfigDependencies,
  type StepfunConfigFieldView,
} from './config'

export const MIMO_PROVIDER = 'mimo' as const

export const MIMO_TTS_MODELS = [
  'mimo-v2.5-tts',
  'mimo-v2.5-tts-voicedesign',
  'mimo-v2.5-tts-voiceclone',
] as const

export type MimoConfigField =
  | 'baseUrl'
  | 'textModel'
  | 'visionModel'
  | 'ttsModel'
  | 'asrModel'

export interface MimoConfig {
  apiKey: string | null
  baseUrl: string
  textModel: string
  visionModel: string
  ttsModel: string
  asrModel: string
}

export type MimoConfigView = Record<MimoConfigField, StepfunConfigFieldView>

export interface MimoSettingsInput {
  baseUrl?: string
  textModel?: string
  visionModel?: string
  ttsModel?: string
  asrModel?: string
}

const DEFAULTS: Record<MimoConfigField, string> = {
  baseUrl: 'https://api.xiaomimimo.com/v1',
  textModel: 'mimo-v2.5',
  visionModel: 'mimo-v2.5',
  ttsModel: 'mimo-v2.5-tts',
  asrModel: 'mimo-v2.5-asr',
}

const ENV_KEYS: Record<MimoConfigField, string> = {
  baseUrl: 'MIMO_BASE_URL',
  textModel: 'MIMO_TEXT_MODEL',
  visionModel: 'MIMO_VISION_MODEL',
  ttsModel: 'MIMO_TTS_MODEL',
  asrModel: 'MIMO_ASR_MODEL',
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function envOrDefault(field: MimoConfigField): StepfunConfigFieldView {
  const value = nonEmpty(process.env[ENV_KEYS[field]])
  return value
    ? { value, source: 'env' }
    : { value: DEFAULTS[field], source: 'default' }
}

function configuredModel(
  route: { provider: string; model: string } | null,
  field: MimoConfigField
): StepfunConfigFieldView {
  return route?.provider === MIMO_PROVIDER
    ? { value: route.model, source: 'settings' }
    : envOrDefault(field)
}

export function resolveMimoBaseUrl(): string {
  return envOrDefault('baseUrl').value.replace(/\/+$/, '')
}

export async function getMimoConfig(
  deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<MimoConfig> {
  const [apiKey, text, vision, tts, asr] = await Promise.all([
    deps.credentials.loadSecret(currentWorkspaceId(), MIMO_PROVIDER),
    deps.modelRoutes.find(currentWorkspaceId(), 'fabricate'),
    deps.modelRoutes.find(currentWorkspaceId(), 'vision-qa'),
    deps.mediaRoutes.find(currentWorkspaceId(), 'tts'),
    deps.mediaRoutes.find(currentWorkspaceId(), 'asr'),
  ])
  return {
    apiKey,
    baseUrl: resolveMimoBaseUrl(),
    textModel: configuredModel(text, 'textModel').value,
    visionModel: configuredModel(vision, 'visionModel').value,
    ttsModel: configuredModel(tts, 'ttsModel').value,
    asrModel: configuredModel(asr, 'asrModel').value,
  }
}

export async function describeMimoConfig(
  deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<MimoConfigView> {
  const [text, vision, tts, asr] = await Promise.all([
    deps.modelRoutes.find(currentWorkspaceId(), 'fabricate'),
    deps.modelRoutes.find(currentWorkspaceId(), 'vision-qa'),
    deps.mediaRoutes.find(currentWorkspaceId(), 'tts'),
    deps.mediaRoutes.find(currentWorkspaceId(), 'asr'),
  ])
  return {
    baseUrl: envOrDefault('baseUrl'),
    textModel: configuredModel(text, 'textModel'),
    visionModel: configuredModel(vision, 'visionModel'),
    ttsModel: configuredModel(tts, 'ttsModel'),
    asrModel: configuredModel(asr, 'asrModel'),
  }
}

async function saveAiModels(
  deps: AiConfigDependencies,
  kinds: readonly AiTaskKind[],
  value: string
): Promise<void> {
  const model = nonEmpty(value)
  await Promise.all(kinds.map((aiTaskKind) =>
    model
      ? deps.modelRoutes.save({
          workspaceId: currentWorkspaceId(),
          aiTaskKind,
          provider: MIMO_PROVIDER,
          model,
        })
      : deps.modelRoutes.remove(currentWorkspaceId(), aiTaskKind)
  ))
}

async function saveMediaModel(
  deps: AiConfigDependencies,
  mediaTaskKind: MediaTaskKind,
  value: string
): Promise<void> {
  const model = nonEmpty(value)
  if (model) {
    await deps.mediaRoutes.save({
      workspaceId: currentWorkspaceId(),
      mediaTaskKind,
      provider: MIMO_PROVIDER,
      model,
    })
  } else {
    await deps.mediaRoutes.remove(currentWorkspaceId(), mediaTaskKind)
  }
}

export async function saveMimoSettings(
  input: MimoSettingsInput,
  deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<void> {
  const requestedBaseUrl = nonEmpty(input.baseUrl)
  if (requestedBaseUrl && requestedBaseUrl.replace(/\/+$/, '') !== DEFAULTS.baseUrl) {
    throw new Error(
      'Persisting a custom MiMo baseUrl is unsupported; use MIMO_BASE_URL'
    )
  }
  const writes: Promise<void>[] = []
  if (input.textModel !== undefined) {
    writes.push(saveAiModels(
      deps,
      ['project-plan', 'shot-spec', 'fabricate'],
      input.textModel
    ))
  }
  if (input.visionModel !== undefined) {
    writes.push(saveAiModels(deps, ['vision-qa'], input.visionModel))
  }
  if (input.ttsModel !== undefined) {
    writes.push(saveMediaModel(deps, 'tts', input.ttsModel))
  }
  if (input.asrModel !== undefined) {
    writes.push(saveMediaModel(deps, 'asr', input.asrModel))
  }
  await Promise.all(writes)
}

export async function saveMimoApiKey(
  apiKey: string,
  verifiedAt = new Date(),
  deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<void> {
  await deps.credentials.save({
    workspaceId: currentWorkspaceId(),
    provider: MIMO_PROVIDER,
    secret: apiKey.trim(),
    verifiedAt,
  })
}
