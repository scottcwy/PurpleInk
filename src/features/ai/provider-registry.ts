import { RouteContractError } from './route-contract-error'

/**
 * 自定义 OpenAI 兼容端点按能力拆成三个身份。
 *
 * 它们不是「同一个端点的三种用法」：`provider_credentials` 以
 * `(workspace_id, provider)` 唯一，所以一个 id 只能持有一份密钥；三份独立端点
 * 就必须是三个 id。配置也分别落在 `workspace_settings` 的三个 key 上。
 * 顺序即设置页与路由下拉的展示顺序，不要随意调整。
 */
export const AI_PROVIDER_IDS = [
  'gemini',
  'stepfun',
  'mimo',
  'openai-compatible',
  'openai-compatible-tts',
  'openai-compatible-asr',
] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]
export type ProviderCapability = 'text' | 'vision' | 'tts' | 'asr'

export interface ProviderDefinition {
  id: AiProviderId
  label: string
  capabilities: readonly ProviderCapability[]
  defaultModels: Partial<Record<ProviderCapability, string>>
}

export const PROVIDER_REGISTRY: Record<AiProviderId, ProviderDefinition> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    capabilities: ['text', 'vision'],
    defaultModels: {
      text: 'gemini-3.1-flash-lite',
      vision: 'gemini-3.6-flash',
    },
  },
  stepfun: {
    id: 'stepfun',
    label: '阶跃星辰',
    capabilities: ['text', 'vision', 'tts', 'asr'],
    defaultModels: {
      text: 'step-3.5-flash',
      vision: 'step-3.7-flash',
      tts: 'stepaudio-2.5-tts',
      asr: 'stepaudio-2.5-asr',
    },
  },
  mimo: {
    id: 'mimo',
    label: '小米 MiMo',
    capabilities: ['text', 'vision', 'tts', 'asr'],
    defaultModels: {
      text: 'mimo-v2.5',
      vision: 'mimo-v2.5',
      tts: 'mimo-v2.5-tts',
      asr: 'mimo-v2.5-asr',
    },
  },
  // 以下三个自定义端点一律不带 defaultModels：模型由用户 profile 提供，registry
  // 不得顶一个编造的模型名，否则设置页会显示一个从未被校验过的模型。
  'openai-compatible': {
    id: 'openai-compatible',
    label: '自定义兼容模型',
    capabilities: ['text', 'vision'],
    defaultModels: {},
  },
  'openai-compatible-tts': {
    id: 'openai-compatible-tts',
    label: '自定义兼容 TTS',
    capabilities: ['tts'],
    defaultModels: {},
  },
  'openai-compatible-asr': {
    id: 'openai-compatible-asr',
    label: '自定义兼容 ASR',
    capabilities: ['asr'],
    defaultModels: {},
  },
}

export function providerSupports(
  provider: AiProviderId,
  capability: ProviderCapability
): boolean {
  return PROVIDER_REGISTRY[provider].capabilities.includes(capability)
}

export function providersFor(
  capability: ProviderCapability
): AiProviderId[] {
  return AI_PROVIDER_IDS.filter((provider) =>
    providerSupports(provider, capability)
  )
}

export function assertProviderCapability(
  provider: AiProviderId,
  capability: ProviderCapability
): void {
  if (providerSupports(provider, capability)) return
  throw new RouteContractError(
    `${PROVIDER_REGISTRY[provider].label} 不支持 ${capability.toUpperCase()} 路由`
  )
}

export function defaultModelFor(
  provider: AiProviderId,
  capability: ProviderCapability
): string {
  assertProviderCapability(provider, capability)
  const model = PROVIDER_REGISTRY[provider].defaultModels[capability]
  if (!model) {
    throw new RouteContractError(
      `${PROVIDER_REGISTRY[provider].label} 尚未配置默认模型`
    )
  }
  return model
}
