import {
  providerSupports,
  type AiProviderId,
  type ProviderCapability,
} from './provider-registry'
import type { PlanKey } from '@/features/billing'

export const MANAGED_PROVIDER_IDS = ['stepfun', 'mimo', 'gemini'] as const
export type ManagedProviderId = (typeof MANAGED_PROVIDER_IDS)[number]
/**
 * 临时 AI 边界类型。billing 合同合并后改为 type-only import，值集合不得分叉。
 */
export type ManagedPlanKey = PlanKey
export interface ManagedModelDefinition {
  provider: ManagedProviderId
  modelId: string
  capabilities: readonly ProviderCapability[]
}
/**
 * 托管服务唯一模型白名单。BYOK 模型由用户 profile 校验，不进入此目录。
 */
export const MANAGED_MODEL_CATALOG = [
  {
    provider: 'stepfun',
    modelId: 'step-3.5-flash',
    capabilities: ['text'],
  },
  {
    provider: 'stepfun',
    modelId: 'step-3.7-flash',
    capabilities: ['vision'],
  },
  {
    provider: 'stepfun',
    modelId: 'stepaudio-2.5-tts',
    capabilities: ['tts'],
  },
  {
    provider: 'stepfun',
    modelId: 'stepaudio-2.5-asr',
    capabilities: ['asr'],
  },
  {
    provider: 'mimo',
    modelId: 'mimo-v2.5',
    capabilities: ['text', 'vision'],
  },
  {
    provider: 'mimo',
    modelId: 'mimo-v2.5-tts',
    capabilities: ['tts'],
  },
  {
    provider: 'mimo',
    modelId: 'mimo-v2.5-asr',
    capabilities: ['asr'],
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.1-flash-lite',
    capabilities: ['text', 'vision'],
  },
] as const satisfies readonly ManagedModelDefinition[]

export type ManagedAiErrorCode =
  | 'MANAGED_GEMINI_FORBIDDEN_FOR_FREE'
  | 'MANAGED_MODEL_NOT_AUTHORIZED'
  | 'MANAGED_CREDENTIAL_UNAVAILABLE'
  | 'MANAGED_UPSTREAM_FAILED'

interface ManagedAiErrorOptions {
  code: ManagedAiErrorCode
  status: 403 | 502 | 503
  retryable: boolean
  message: string
}

/**
 * 公开错误只保留稳定类别与脱敏文案，不接受 provider 原始错误或 credential。
 */
export class ManagedAiError extends Error {
  override readonly name = 'ManagedAiError'
  readonly code: ManagedAiErrorCode
  readonly status: 403 | 502 | 503
  readonly retryable: boolean

  constructor(options: ManagedAiErrorOptions) {
    super(options.message)
    this.code = options.code
    this.status = options.status
    this.retryable = options.retryable
  }

  toJSON(): ManagedAiErrorOptions & { name: string } {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      message: this.message,
    }
  }
}

export interface ManagedRouteAuthorizationInput {
  plan: ManagedPlanKey
  provider: AiProviderId
  modelId: string
  capability: ProviderCapability
}
export interface ManagedRouteAuthorization {
  funding: 'managed' | 'byok'
  deductsManagedPool: boolean
}

export function authorizeManagedRoute(
  input: ManagedRouteAuthorizationInput,
): ManagedRouteAuthorization {
  if (!isManagedProvider(input.provider)) {
    if (!providerSupports(input.provider, input.capability)) {
      throw modelNotAuthorized()
    }
    return { funding: 'byok', deductsManagedPool: false }
  }
  if (input.plan === 'free' && input.provider === 'gemini') {
    throw new ManagedAiError({
      code: 'MANAGED_GEMINI_FORBIDDEN_FOR_FREE',
      status: 403,
      retryable: false,
      message: 'Free 套餐不可使用 Gemini 托管服务',
    })
  }
  const model = MANAGED_MODEL_CATALOG.find((entry) =>
    entry.provider === input.provider
    && entry.modelId === input.modelId
  )
  if (!model || !managedModelSupports(model, input.capability)) {
    throw modelNotAuthorized()
  }
  return { funding: 'managed', deductsManagedPool: true }
}

export interface FilterFallbacksInput {
  plan: ManagedPlanKey
  capability: ProviderCapability
  candidates: readonly AiProviderId[]
}
/**
 * 只过滤调用方已经显式配置的候选，保持顺序；不会凭空添加或替换 provider。
 */
export function filterAuthorizedFallbacks(
  input: FilterFallbacksInput,
): AiProviderId[] {
  return [...new Set(input.candidates)].filter((provider) => {
    if (!providerSupports(provider, input.capability)) return false
    if (!isManagedProvider(provider)) return true
    if (input.plan === 'free' && provider === 'gemini') return false
    return MANAGED_MODEL_CATALOG.some((entry) =>
      entry.provider === provider
      && managedModelSupports(entry, input.capability)
    )
  })
}

export type ManagedUsage =
  | {
      kind: 'text'
      inputTokens: number
      cachedInputTokens?: number
      outputTokens: number
      reasoningTokens?: number
    }
  | {
      kind: 'tts'
      inputCharacters: number
      outputAudioSeconds: number
      inputTokens?: number
      outputAudioTokens?: number
    }
  | {
      kind: 'asr'
      inputAudioSeconds: number
      inputAudioTokens?: number
      outputTokens?: number
    }
  | {
      kind: 'image'
      operation: 'understand' | 'generate'
      inputImages?: number
      outputImages?: number
      inputTokens?: number
      outputTokens?: number
      width?: number
      height?: number
    }
  | {
      kind: 'video'
      operation: 'understand' | 'generate' | 'render'
      inputSeconds?: number
      outputSeconds?: number
      inputTokens?: number
      outputTokens?: number
      width?: number
      height?: number
    }
  | {
      kind: 'tool'
      tool: 'web-search' | 'image-search' | 'voice-clone'
      calls: number
    }

export function managedUpstreamError(_cause: unknown): ManagedAiError {
  return new ManagedAiError({
    code: 'MANAGED_UPSTREAM_FAILED',
    status: 502,
    retryable: true,
    message: '托管 AI 服务本次执行失败，请稍后重试',
  })
}

export function managedCredentialUnavailableError(): ManagedAiError {
  return new ManagedAiError({
    code: 'MANAGED_CREDENTIAL_UNAVAILABLE',
    status: 503,
    retryable: true,
    message: '托管 AI 服务暂时不可用，请稍后重试',
  })
}

export function isManagedProvider(
  provider: AiProviderId,
): provider is ManagedProviderId {
  return (MANAGED_PROVIDER_IDS as readonly AiProviderId[]).includes(provider)
}

function modelNotAuthorized(): ManagedAiError {
  return new ManagedAiError({
    code: 'MANAGED_MODEL_NOT_AUTHORIZED',
    status: 403,
    retryable: false,
    message: '当前套餐不可使用所选托管模型',
  })
}

function managedModelSupports(
  model: ManagedModelDefinition,
  capability: ProviderCapability,
): boolean {
  return model.capabilities.includes(capability)
}
