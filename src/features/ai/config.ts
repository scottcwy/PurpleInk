import 'server-only'
import {
  PostgresProviderCredentialStore,
  type ProviderCredentialStore,
} from '@/features/credentials'
import {
  type AiTaskKind,
  PostgresMediaRouteRepository,
  PostgresModelRouteRepository,
} from '@/features/routing'
import { getDb, LOCAL_WORKSPACE_ID } from '@/lib/db/client'

export type StepfunModelField =
  | 'baseUrl'
  | 'chatModel'
  | 'ttsModel'
  | 'asrModel'
  | 'visionModel'
export type StepfunConfigSource = 'settings' | 'env' | 'default'

export interface StepfunConfigFieldView {
  value: string
  source: StepfunConfigSource
}

export type StepfunConfigView = Record<StepfunModelField, StepfunConfigFieldView>

export interface StepfunConfig {
  apiKey: string | null
  baseUrl: string
  chatModel: string
  ttsModel: string
  asrModel: string
  visionModel: string
}

export interface AiConfigDependencies {
  credentials: ProviderCredentialStore
  modelRoutes: Pick<
    PostgresModelRouteRepository,
    'find' | 'remove' | 'resolve' | 'save'
  >
  mediaRoutes: Pick<
    PostgresMediaRouteRepository,
    'find' | 'remove' | 'resolve' | 'save'
  >
}

const credentials = new PostgresProviderCredentialStore(getDb)
const dependencies: AiConfigDependencies = {
  credentials,
  modelRoutes: new PostgresModelRouteRepository(getDb, credentials),
  mediaRoutes: new PostgresMediaRouteRepository(getDb, credentials),
}

const DEFAULTS: Record<StepfunModelField, string> = {
  baseUrl: 'https://api.stepfun.com/v1',
  chatModel: 'step-3.5-flash',
  ttsModel: 'stepaudio-2.5-tts',
  asrModel: 'stepaudio-2.5-asr',
  visionModel: 'step-3.7-flash',
}

const ENV_KEYS: Record<StepfunModelField, string> = {
  baseUrl: 'STEPFUN_BASE_URL',
  chatModel: 'STEPFUN_CHAT_MODEL',
  ttsModel: 'STEPFUN_TTS_MODEL',
  asrModel: 'STEPFUN_ASR_MODEL',
  visionModel: 'STEPFUN_VISION_MODEL',
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function envOrDefault(field: StepfunModelField): StepfunConfigFieldView {
  const value = nonEmpty(process.env[ENV_KEYS[field]])
  return value
    ? { value, source: 'env' }
    : { value: DEFAULTS[field], source: 'default' }
}

function configuredModel(
  provider: string | undefined,
  model: string | undefined,
  field: StepfunModelField,
): StepfunConfigFieldView {
  return provider === 'stepfun' && model
    ? { value: model, source: 'settings' }
    : envOrDefault(field)
}

export function getAiConfigDependencies(): AiConfigDependencies {
  return dependencies
}

export function resolveStepfunBaseUrl(): string {
  return envOrDefault('baseUrl').value
}

export async function getStepfunConfig(
  deps: AiConfigDependencies = dependencies,
): Promise<StepfunConfig> {
  const [storedKey, chat, vision, tts, asr] = await Promise.all([
    deps.credentials.loadSecret(LOCAL_WORKSPACE_ID, 'stepfun'),
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'fabricate'),
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'vision-qa'),
    deps.mediaRoutes.find(LOCAL_WORKSPACE_ID, 'tts'),
    deps.mediaRoutes.find(LOCAL_WORKSPACE_ID, 'asr'),
  ])
  return {
    apiKey: storedKey,
    baseUrl: resolveStepfunBaseUrl(),
    chatModel: configuredModel(chat?.provider, chat?.model, 'chatModel').value,
    ttsModel: configuredModel(tts?.provider, tts?.model, 'ttsModel').value,
    asrModel: configuredModel(asr?.provider, asr?.model, 'asrModel').value,
    visionModel: configuredModel(
      vision?.provider,
      vision?.model,
      'visionModel',
    ).value,
  }
}

export async function describeStepfunConfig(
  deps: AiConfigDependencies = dependencies,
): Promise<StepfunConfigView> {
  const [chat, vision, tts, asr] = await Promise.all([
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'fabricate'),
    deps.modelRoutes.find(LOCAL_WORKSPACE_ID, 'vision-qa'),
    deps.mediaRoutes.find(LOCAL_WORKSPACE_ID, 'tts'),
    deps.mediaRoutes.find(LOCAL_WORKSPACE_ID, 'asr'),
  ])
  return {
    baseUrl: envOrDefault('baseUrl'),
    chatModel: configuredModel(chat?.provider, chat?.model, 'chatModel'),
    ttsModel: configuredModel(tts?.provider, tts?.model, 'ttsModel'),
    asrModel: configuredModel(asr?.provider, asr?.model, 'asrModel'),
    visionModel: configuredModel(
      vision?.provider,
      vision?.model,
      'visionModel',
    ),
  }
}

export interface StepfunModelSettingsInput {
  baseUrl?: string
  chatModel?: string
  ttsModel?: string
  asrModel?: string
  visionModel?: string
}

async function saveAiModel(
  deps: AiConfigDependencies,
  kinds: readonly AiTaskKind[],
  value: string,
): Promise<void> {
  const model = nonEmpty(value)
  await Promise.all(kinds.map((aiTaskKind) => model
    ? deps.modelRoutes.save({
        workspaceId: LOCAL_WORKSPACE_ID,
        aiTaskKind,
        provider: 'stepfun',
        model,
      })
    : deps.modelRoutes.remove(LOCAL_WORKSPACE_ID, aiTaskKind)))
}

export async function saveStepfunModelSettings(
  input: StepfunModelSettingsInput,
  deps: AiConfigDependencies = dependencies,
): Promise<void> {
  const requestedBaseUrl = nonEmpty(input.baseUrl)
  if (requestedBaseUrl && requestedBaseUrl !== DEFAULTS.baseUrl) {
    throw new Error(
      'Persisting a custom StepFun baseUrl is unsupported; use STEPFUN_BASE_URL',
    )
  }
  const writes: Promise<unknown>[] = []
  if (input.chatModel !== undefined) {
    writes.push(saveAiModel(
      deps,
      ['project-plan', 'shot-spec', 'fabricate'],
      input.chatModel,
    ))
  }
  if (input.visionModel !== undefined) {
    writes.push(saveAiModel(deps, ['vision-qa'], input.visionModel))
  }
  for (const [mediaTaskKind, value] of [
    ['tts', input.ttsModel],
    ['asr', input.asrModel],
  ] as const) {
    if (value === undefined) continue
    const model = nonEmpty(value)
    writes.push(model
      ? deps.mediaRoutes.save({
          workspaceId: LOCAL_WORKSPACE_ID,
          mediaTaskKind,
          provider: 'stepfun',
          model,
        })
      : deps.mediaRoutes.remove(LOCAL_WORKSPACE_ID, mediaTaskKind))
  }
  await Promise.all(writes)
}
