import 'server-only'
import {
  PostgresProviderCredentialStore,
  type ProviderCredentialStore,
} from '@/features/credentials'
import { getCurrentPlanKey, type PlanKey } from '@/features/billing'
import {
  PostgresMediaRouteRepository,
  PostgresModelRouteRepository,
} from '@/features/routing'
import { getDb } from '@/lib/db/client'
import {
  PostgresFallbackProviderStore,
  type FallbackProviderStore,
} from './fallback-provider-store'
import {
  PostgresOpenAiCompatibleAudioProfileStore,
  type OpenAiCompatibleAudioProfileStore,
} from './openai-compatible-audio-profile-store'
import {
  PostgresOpenAiCompatibleProfileStore,
  type OpenAiCompatibleProfileStore,
} from './openai-compatible-profile-store'
import { resolveManagedCredential } from './managed-credentials'
import {
  managedModelCatalogRepository,
  type ManagedModelCatalogRepository,
} from './managed-model-catalog-repository'
import { RouteContractError } from './route-contract-error'

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
  openAiCompatibleProfiles?: OpenAiCompatibleProfileStore
  openAiCompatibleAudioProfiles?: OpenAiCompatibleAudioProfileStore
  /** 熔断降级链的显式备选 provider（模式 H 阶段 4）；缺省即无备选。 */
  fallbackProviders?: FallbackProviderStore
  /** 当前 workspace 套餐；测试可注入，默认经 billing 公共投影读取。 */
  currentPlan?: () => Promise<PlanKey>
  /** 托管模型授权目录；生产环境唯一实现读取 Postgres。 */
  managedModelCatalog?: ManagedModelCatalogRepository
}

const credentials = new PostgresProviderCredentialStore(getDb)
const dependencies: AiConfigDependencies = {
  credentials,
  modelRoutes: new PostgresModelRouteRepository(getDb, credentials),
  mediaRoutes: new PostgresMediaRouteRepository(getDb, credentials),
  openAiCompatibleProfiles: new PostgresOpenAiCompatibleProfileStore(getDb),
  openAiCompatibleAudioProfiles:
    new PostgresOpenAiCompatibleAudioProfileStore(getDb),
  fallbackProviders: new PostgresFallbackProviderStore(getDb),
  currentPlan: getCurrentPlanKey,
  managedModelCatalog: managedModelCatalogRepository,
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
  chatModel: '',
  ttsModel: '',
  asrModel: '',
  visionModel: '',
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function envOrDefault(field: StepfunModelField): StepfunConfigFieldView {
  const value = field === 'baseUrl' ? nonEmpty(process.env[ENV_KEYS[field]]) : null
  return value
    ? { value, source: 'env' }
    : { value: DEFAULTS[field], source: 'default' }
}

export function getAiConfigDependencies(): AiConfigDependencies {
  return dependencies
}

export function resolveStepfunBaseUrl(): string {
  return envOrDefault('baseUrl').value
}

export async function getStepfunConfig(
  _deps: AiConfigDependencies = dependencies,
): Promise<StepfunConfig> {
  return {
    apiKey: resolveManagedCredential('stepfun'),
    baseUrl: resolveStepfunBaseUrl(),
    chatModel: DEFAULTS.chatModel,
    ttsModel: DEFAULTS.ttsModel,
    asrModel: DEFAULTS.asrModel,
    visionModel: DEFAULTS.visionModel,
  }
}

export async function describeStepfunConfig(
  _deps: AiConfigDependencies = dependencies,
): Promise<StepfunConfigView> {
  return {
    baseUrl: envOrDefault('baseUrl'),
    chatModel: envOrDefault('chatModel'),
    ttsModel: envOrDefault('ttsModel'),
    asrModel: envOrDefault('asrModel'),
    visionModel: envOrDefault('visionModel'),
  }
}

export interface StepfunModelSettingsInput {
  baseUrl?: string
  chatModel?: string
  ttsModel?: string
  asrModel?: string
  visionModel?: string
}

export async function saveStepfunModelSettings(
  input: StepfunModelSettingsInput,
  _deps: AiConfigDependencies = dependencies,
): Promise<void> {
  const requestedBaseUrl = nonEmpty(input.baseUrl)
  if (requestedBaseUrl && requestedBaseUrl !== DEFAULTS.baseUrl) {
    throw new Error(
      'Persisting a custom StepFun baseUrl is unsupported; use STEPFUN_BASE_URL',
    )
  }
  if (
    input.chatModel !== undefined ||
    input.visionModel !== undefined ||
    input.ttsModel !== undefined ||
    input.asrModel !== undefined
  ) {
    throw new RouteContractError('StepFun 托管模型由服务端目录管理，不接受设置写入')
  }
}
