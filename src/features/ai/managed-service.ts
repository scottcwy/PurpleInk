import {
  providerSupports,
  type AiProviderId,
  type ProviderCapability,
} from './provider-registry'
import { comparePlans, type PlanKey } from '@/features/billing'
import {
  managedModelCatalogRepository,
  type ManagedModelCatalogRepository,
  type ManagedModelDefinition,
} from './managed-model-catalog-repository'
import type { ProviderFunding } from './provider-funding-store'
import {
  BUILT_IN_PROVIDER_IDS,
  type BuiltInProviderId,
} from '@/lib/config/generated/ai-billing-manifest'

export const MANAGED_PROVIDER_IDS = BUILT_IN_PROVIDER_IDS
export type ManagedProviderId = BuiltInProviderId
/**
 * 临时 AI 边界类型。billing 合同合并后改为 type-only import，值集合不得分叉。
 */
export type ManagedPlanKey = PlanKey
export type { ManagedModelCatalogRepository, ManagedModelDefinition }

export type ManagedAiErrorCode =
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
  funding?: ProviderFunding
}
export type ManagedRouteAuthorization = {
  funding: 'managed' | 'byok'
  deductsManagedPool: boolean
  catalogId?: string
}

export async function authorizeManagedRoute(
  input: ManagedRouteAuthorizationInput,
  catalog: ManagedModelCatalogRepository = managedModelCatalogRepository,
): Promise<ManagedRouteAuthorization> {
  if (!isManagedProvider(input.provider)) {
    if (!providerSupports(input.provider, input.capability)) {
      throw modelNotAuthorized()
    }
    return { funding: 'byok', deductsManagedPool: false }
  }
  const model = await catalog.find({
    provider: input.provider,
    modelId: input.modelId,
    capability: input.capability,
  })
  if (!model || !model.enabled) {
    throw modelNotAuthorized()
  }
  if (input.funding === 'byok') {
    return {
      funding: 'byok',
      deductsManagedPool: false,
      catalogId: model.id,
    }
  }
  if (comparePlans(input.plan, model.minimumPlanKey) < 0) {
    throw new ManagedAiError({
      code: 'MANAGED_MODEL_NOT_AUTHORIZED',
      status: 403,
      retryable: false,
      message: '当前套餐不可使用所选托管模型',
    })
  }
  return {
    funding: 'managed',
    deductsManagedPool: true,
    catalogId: model.id,
  }
}

export type ManagedUsage =
  | {
      kind: 'text'
      inputTokens: number
      cachedInputTokens?: number
      cacheWriteInputTokens?: number
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
    retryable: false,
    message: '托管 AI 服务凭据未配置，请联系管理员完成服务配置。',
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
