import 'server-only'
import {
  createModels,
  createProvider,
} from '@earendil-works/pi-ai'
import type { Api, ApiKeyAuth, Model, MutableModels } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { DirectorCanvasNodeType } from '@/features/canvas'
import { assertBillingAvailable } from '@/features/billing'
import {
  DIRECTOR_NODE_TYPES,
  resolveDirectorModelTarget,
  type ModelCapability,
} from '@/features/ai/model-routing'
import type { AiProviderId } from '@/features/ai/provider-registry'
import type {
  AdapterProtocol,
  ResolvedExecutionPlanV2,
} from '@/features/ai/execution-plan'
import { RouteContractError } from '@/features/ai/route-contract-error'
import type { PipelineStage } from './types'

/** 阶段兜底节点类型：仅在节点类型缺失/不可信时使用，与全局泳道播种保持一致。 */
const STAGE_FALLBACK_NODE_TYPE: Record<PipelineStage, DirectorCanvasNodeType> = {
  INGEST: 'script-import',
  DIRECT: 'shot-split',
  SHOT_SPEC: 'shot-script',
  FABRICATE: 'shot-codegen',
  ASSEMBLE: 'score',
  FINALIZE: 'export',
}

/**
 * 显式声明为 `Record<AiProviderId, …>`：注册新供应商时漏补条目会变成编译错误，
 * 而不是运行期 `undefined` 拼进 routeLabel 或错误文案。
 */
const PROVIDER_LABEL: Record<AiProviderId, string> = {
  gemini: 'Gemini',
  stepfun: 'StepFun',
  mimo: '小米 MiMo',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI 兼容模型服务',
  'openai-compatible-tts': '自定义兼容 TTS',
  'openai-compatible-asr': '自定义兼容 ASR',
}

/**
 * 请求整形上限：只用于本地 maxTokens 裁剪与上下文预算估算，
 * 不是供应商元数据，也不会出现在任何用户可见字段里。
 */
const REQUEST_SHAPE: Record<
  AiProviderId,
  { contextWindow: number; maxTokens: number } | null
> = {
  gemini: { contextWindow: 1_048_576, maxTokens: 65_536 },
  stepfun: { contextWindow: 131_072, maxTokens: 32_768 },
  mimo: { contextWindow: 1_048_576, maxTokens: 131_072 },
  openai: { contextWindow: 400_000, maxTokens: 128_000 },
  anthropic: { contextWindow: 1_000_000, maxTokens: 128_000 },
  'openai-compatible': { contextWindow: 131_072, maxTokens: 32_768 },
  // 纯音频端点不承担 Director 文本会话。`null` 是显式表态而不是漏项：编造一份
  // token 预算会让一个不可能成功的会话看起来配置齐全。
  'openai-compatible-tts': null,
  'openai-compatible-asr': null,
}

export interface DirectorModelRuntime {
  models: MutableModels
  model: Model<Api>
  apiKey: string
  /** 实际执行的 provider id：熔断记账（pi-session 收敛点）按它计数。 */
  providerId: AiProviderId
  providerLabel: string
  funding: 'managed' | 'byok'
  /** 供失败分类使用的选型描述，不含任何凭据。 */
  routeLabel: string
  modelId: string
  logicalModelId?: string
  deploymentId?: string
  channelId?: string
  adapterProtocol?: AdapterProtocol
  officialPriceIdentity?: string
  providerPoolId?: string
  failureDomainId?: string
  fallbackDeploymentId?: string
  fallbackModel?: Model<Api>
  fallbackModelId?: string
  fallback?: {
    deploymentId: string
    logicalModelId: string
    officialPriceIdentity: string
  }
  maxOutputTokens: number
  deductsManagedPool: boolean
  resolvedPlan?: ResolvedExecutionPlanV2
}

/**
 * 按可信节点类型选出 Director 的模型，并组装对应的 pi provider。
 *
 * 选型真值仍在 `resolveDirectorModelTarget`（DB 路由 > env > 代码默认值）；
 * 本模块只负责把结果翻译成 pi 的 Provider/Model，缺 Key 时显式失败不兜底。
 */
export async function createDirectorModelRuntime(input: {
  nodeType?: string | null
  stage: PipelineStage
  capability?: ModelCapability
}): Promise<DirectorModelRuntime> {
  const nodeType = trustedNodeType(input.nodeType, input.stage)
  const target = await resolveDirectorModelTarget(
    nodeType,
    input.capability ?? 'text',
  )
  const label = PROVIDER_LABEL[target.provider]
  const requestShape = REQUEST_SHAPE[target.provider]
  // 纯音频端点不可能承担文本会话。这是设置面矛盾而非外部抖动，用
  // RouteContractError 让分类器直接判定不可重试，而不是让画布劝用户反复重试。
  if (!requestShape) {
    throw new RouteContractError(
      `${label} 只提供音频能力，不能承担 Director 文本会话`,
    )
  }
  if (!target.apiKey) {
    throw new Error(`${label} API Key 未配置，无法执行 Director 阶段`)
  }
  const baseUrl = trimTrailingSlash(target.baseUrl)
  const api: Api = target.adapterProtocol ?? 'openai-completions'
  const model: Model<Api> = {
    id: target.modelId,
    name: target.modelId,
    api,
    provider: target.provider,
    baseUrl,
    // 本项目不使用隐藏推理：既不请求 thinking，也不持久化 thinking。
    reasoning: false,
    input: ['text', 'image'],
    // pi 的 cost 字段不参与结算；真实费用由版本化 rate card 与统一账本计算。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...requestShape,
  }
  const fallbackModel: Model<Api> | undefined = target.fallback
    ? {
        ...model,
        id: target.fallback.modelId,
        name: target.fallback.modelId,
      }
    : undefined
  const models = createModels()
  models.setProvider(
    createProvider({
      id: target.provider,
      baseUrl,
      auth: {
        apiKey: resolvedRouteApiKeyAuth(`${label} API Key`, target.apiKey),
      },
      api: api === 'anthropic-messages'
        ? anthropicMessagesApi()
        : openAICompletionsApi(),
      models: fallbackModel ? [model, fallbackModel] : [model],
    }),
  )
  return {
    models,
    model,
    apiKey: target.apiKey,
    providerId: target.provider,
    providerLabel: PROVIDER_LABEL[target.provider],
    funding: target.funding ?? (target.deductsManagedPool === true ? 'managed' : 'byok'),
    modelId: target.modelId,
    ...(target.logicalModelId ? { logicalModelId: target.logicalModelId } : {}),
    ...(target.deploymentId ? { deploymentId: target.deploymentId } : {}),
    ...(target.channelId ? { channelId: target.channelId } : {}),
    ...(target.adapterProtocol ? { adapterProtocol: target.adapterProtocol } : {}),
    ...(target.officialPriceIdentity
      ? { officialPriceIdentity: target.officialPriceIdentity }
      : {}),
    ...(target.providerPoolId ? { providerPoolId: target.providerPoolId } : {}),
    ...(target.failureDomainId ? { failureDomainId: target.failureDomainId } : {}),
    ...(target.fallbackDeploymentId
      ? { fallbackDeploymentId: target.fallbackDeploymentId }
      : {}),
    ...(fallbackModel
      ? {
          fallbackModel,
          fallbackModelId: fallbackModel.id,
          fallback: target.fallback
            ? {
                deploymentId: target.fallback.deploymentId,
                logicalModelId: target.fallback.logicalModelId,
                officialPriceIdentity: target.fallback.officialPriceIdentity,
              }
            : undefined,
        }
      : {}),
    maxOutputTokens: requestShape.maxTokens,
    deductsManagedPool: target.deductsManagedPool === true,
    ...(target.resolvedPlan ? { resolvedPlan: target.resolvedPlan } : {}),
    routeLabel: `${target.provider}/${target.modelId}`,
  }
}

/** 入队前的轻量额度预检；BYOK 路由不受平台成本池影响。 */
export async function assertDirectorBillingAvailable(input: {
  nodeType?: string | null
  stage: PipelineStage
}): Promise<void> {
  const target = await resolveDirectorModelTarget(
    trustedNodeType(input.nodeType, input.stage),
    'text',
  )
  if (target.deductsManagedPool === true) {
    await assertBillingAvailable()
  }
}

function trustedNodeType(
  nodeType: string | null | undefined,
  stage: PipelineStage,
): DirectorCanvasNodeType {
  const trusted = DIRECTOR_NODE_TYPES.find((candidate) => candidate === nodeType)
  return trusted ?? STAGE_FALLBACK_NODE_TYPE[stage]
}

/**
 * Director 路由已在服务端解析并完成授权；PI transport 必须消费这个最终值，
 * 不能再次回退旧环境变量，否则托管凭据与实际请求会发生分叉。
 */
function resolvedRouteApiKeyAuth(name: string, apiKey: string): ApiKeyAuth {
  return {
    name,
    resolve: async () => ({
      auth: { apiKey },
      source: 'resolved route credential',
    }),
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.replace(/\/+$/, '') : value
}
