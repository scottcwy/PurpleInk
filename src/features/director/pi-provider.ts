import 'server-only'
import {
  createModels,
  createProvider,
  envApiKeyAuth,
} from '@earendil-works/pi-ai'
import type { Api, Model, MutableModels } from '@earendil-works/pi-ai'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { CanvasNodeType } from '@/features/canvas'
import {
  DIRECTOR_NODE_TYPES,
  resolveDirectorModelTarget,
} from '@/features/ai/model-routing'
import type { AiProviderId } from '@/features/ai/provider-registry'
import type { PipelineStage } from './types'

/** 阶段兜底节点类型：仅在节点类型缺失/不可信时使用，与全局泳道播种保持一致。 */
const STAGE_FALLBACK_NODE_TYPE: Record<PipelineStage, CanvasNodeType> = {
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
  'openai-compatible': 'OpenAI 兼容模型服务',
}

/**
 * 请求整形上限：只用于本地 maxTokens 裁剪与上下文预算估算，
 * 不是供应商元数据，也不会出现在任何用户可见字段里。
 */
const REQUEST_SHAPE: Record<
  AiProviderId,
  { contextWindow: number; maxTokens: number }
> = {
  gemini: { contextWindow: 1_048_576, maxTokens: 65_536 },
  stepfun: { contextWindow: 131_072, maxTokens: 32_768 },
  mimo: { contextWindow: 1_048_576, maxTokens: 131_072 },
  'openai-compatible': { contextWindow: 131_072, maxTokens: 32_768 },
}

/**
 * pi 的 `envApiKeyAuth` 只用于提示用户「该填哪个环境变量」，真实凭据来自
 * `resolveDirectorModelTarget` 的加密存储。同样显式按 provider 声明，避免新
 * 供应商落到某个兜底分支上给出错误的变量名。
 */
const AUTH_ENV_KEYS: Record<AiProviderId, readonly string[]> = {
  gemini: ['GEMINI_API_KEY'],
  stepfun: ['STEP_API_KEY'],
  mimo: ['MIMO_API_KEY'],
  'openai-compatible': ['OPENAI_COMPATIBLE_API_KEY'],
}

export interface DirectorModelRuntime {
  models: MutableModels
  model: Model<Api>
  apiKey: string
  /** 供失败分类使用的选型描述，不含任何凭据。 */
  routeLabel: string
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
}): Promise<DirectorModelRuntime> {
  const nodeType = trustedNodeType(input.nodeType, input.stage)
  const target = await resolveDirectorModelTarget(nodeType, 'text')
  const label = PROVIDER_LABEL[target.provider]
  if (!target.apiKey) {
    throw new Error(`${label} API Key 未配置，无法执行 Director 阶段`)
  }
  const baseUrl = target.provider === 'gemini'
    ? nativeGoogleBaseUrl(target.baseUrl)
    : trimTrailingSlash(target.baseUrl)
  const api: Api = target.provider === 'gemini'
    ? 'google-generative-ai'
    : 'openai-completions'
  const model: Model<Api> = {
    id: target.modelId,
    name: target.modelId,
    api,
    provider: target.provider,
    baseUrl,
    // 本项目不使用隐藏推理：既不请求 thinking，也不持久化 thinking。
    reasoning: false,
    input: ['text', 'image'],
    // 成本核算不在本项目范围内，保持 0 而不是编造费率。
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...REQUEST_SHAPE[target.provider],
  }
  const models = createModels()
  models.setProvider(
    createProvider({
      id: target.provider,
      baseUrl,
      auth: {
        apiKey: envApiKeyAuth(
          `${label} API Key`,
          [...AUTH_ENV_KEYS[target.provider]],
        ),
      },
      api: target.provider === 'gemini'
        ? googleGenerativeAIApi()
        : openAICompletionsApi(),
      models: [model],
    }),
  )
  return {
    models,
    model,
    apiKey: target.apiKey,
    routeLabel: `${target.provider}/${target.modelId}`,
  }
}

function trustedNodeType(
  nodeType: string | null | undefined,
  stage: PipelineStage,
): CanvasNodeType {
  const trusted = DIRECTOR_NODE_TYPES.find((candidate) => candidate === nodeType)
  return trusted ?? STAGE_FALLBACK_NODE_TYPE[stage]
}

/**
 * Gemini 的项目配置面用的是 OpenAI 兼容端点（`/v1beta/openai/`），
 * 但 Director 走原生 Google API，因此把 `/openai` 后缀剥回 `/v1beta`。
 */
function nativeGoogleBaseUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlash(baseUrl)
  return trimmed.endsWith('/openai') ? trimmed.slice(0, -'/openai'.length) : trimmed
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.replace(/\/+$/, '') : value
}
