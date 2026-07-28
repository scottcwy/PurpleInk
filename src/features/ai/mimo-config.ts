import 'server-only'
import {
  type AiConfigDependencies,
  getAiConfigDependencies,
  type StepfunConfigFieldView,
} from './config'
import { resolveManagedCredential } from './managed-credentials'
import { RouteContractError } from './route-contract-error'

export const MIMO_PROVIDER = 'mimo' as const

export const MIMO_TTS_MODELS = [
  'mimo-v2.5-tts',
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
  const value = field === 'baseUrl' ? nonEmpty(process.env[ENV_KEYS[field]]) : null
  return value
    ? { value, source: 'env' }
    : { value: DEFAULTS[field], source: 'default' }
}

export function resolveMimoBaseUrl(): string {
  return envOrDefault('baseUrl').value.replace(/\/+$/, '')
}

export async function getMimoConfig(
  _deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<MimoConfig> {
  return {
    apiKey: resolveManagedCredential(MIMO_PROVIDER),
    baseUrl: resolveMimoBaseUrl(),
    textModel: DEFAULTS.textModel,
    visionModel: DEFAULTS.visionModel,
    ttsModel: DEFAULTS.ttsModel,
    asrModel: DEFAULTS.asrModel,
  }
}

export async function describeMimoConfig(
  _deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<MimoConfigView> {
  return {
    baseUrl: envOrDefault('baseUrl'),
    textModel: envOrDefault('textModel'),
    visionModel: envOrDefault('visionModel'),
    ttsModel: envOrDefault('ttsModel'),
    asrModel: envOrDefault('asrModel'),
  }
}

export async function saveMimoSettings(
  input: MimoSettingsInput,
  _deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<void> {
  const requestedBaseUrl = nonEmpty(input.baseUrl)
  if (requestedBaseUrl && requestedBaseUrl.replace(/\/+$/, '') !== DEFAULTS.baseUrl) {
    throw new Error(
      'Persisting a custom MiMo baseUrl is unsupported; use MIMO_BASE_URL'
    )
  }
  if (
    input.textModel !== undefined ||
    input.visionModel !== undefined ||
    input.ttsModel !== undefined ||
    input.asrModel !== undefined
  ) {
    throw new RouteContractError('MiMo 托管模型由服务端目录管理，不接受设置写入')
  }
}

export async function saveMimoApiKey(
  _apiKey: string,
  _verifiedAt = new Date(),
  _deps: AiConfigDependencies = getAiConfigDependencies()
): Promise<void> {
  throw new RouteContractError('MiMo 托管凭据由服务端管理，不接受设置写入')
}
