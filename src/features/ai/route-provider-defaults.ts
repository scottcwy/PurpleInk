import 'server-only'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { type AiConfigDependencies, getStepfunConfig } from './config'
import { getGeminiConfig } from './gemini-config'
import { getMimoConfig } from './mimo-config'
import { CUSTOM_OPENAI_PROVIDER } from './openai-compatible-config'
import { assertProviderCapability, type AiProviderId, type ProviderCapability } from './provider-registry'
import { RouteContractError } from './route-contract-error'
import type { RouteTarget } from './route-target'

/** 供应商默认值：一次配置读取同时给出端点、凭据与模型推导。 */
export interface ProviderDefaults {
  baseUrl: string
  apiKey: string | null
  modelFor: (target: RouteTarget, capability: ProviderCapability) => string
}

/**
 * 按供应商解析端点、凭据与模型推导函数。
 *
 * 这是模型 ID 的**唯一**推导入口：设置页展示（`describeDirectorRoutes` /
 * `saveDirectorRoutes`）与实际执行（`resolveDirectorModelTarget`）都必须调用
 * 同一个 `modelFor`，否则会出现「设置页显示一个模型、真跑另一个模型」
 * （真实事故：project-plan 节点展示 fastModel、执行 primaryModel）。
 */
export async function providerDefaults(
  provider: AiProviderId,
  deps: AiConfigDependencies,
): Promise<ProviderDefaults> {
  if (provider === 'stepfun') return stepfunDefaults(await getStepfunConfig(deps))
  if (provider === 'mimo') return mimoDefaults(await getMimoConfig(deps))
  if (provider === CUSTOM_OPENAI_PROVIDER) return customOpenAiDefaults(deps)
  return geminiDefaults(await getGeminiConfig(deps))
}

function stepfunDefaults(
  config: Awaited<ReturnType<typeof getStepfunConfig>>,
): ProviderDefaults {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelFor: (target, capability) => {
      assertProviderCapability('stepfun', capability)
      if (target.domain === 'media') {
        return target.kind === 'tts' ? config.ttsModel : config.asrModel
      }
      return capability === 'vision' ? config.visionModel : config.chatModel
    },
  }
}

function mimoDefaults(
  config: Awaited<ReturnType<typeof getMimoConfig>>,
): ProviderDefaults {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelFor: (target, capability) => {
      assertProviderCapability('mimo', capability)
      if (target.domain === 'media') {
        return target.kind === 'tts' ? config.ttsModel : config.asrModel
      }
      return capability === 'vision' ? config.visionModel : config.textModel
    },
  }
}

async function customOpenAiDefaults(
  deps: AiConfigDependencies,
): Promise<ProviderDefaults> {
  const profiles = deps.openAiCompatibleProfiles
  if (!profiles) throw new RouteContractError('OpenAI 兼容模型配置存储不可用')
  const [profile, apiKey] = await Promise.all([
    profiles.find(LOCAL_WORKSPACE_ID),
    deps.credentials.loadSecret(LOCAL_WORKSPACE_ID, CUSTOM_OPENAI_PROVIDER),
  ])
  if (!profile) throw new RouteContractError('OpenAI 兼容模型服务尚未配置')
  return {
    baseUrl: profile.baseUrl,
    apiKey,
    modelFor: (_target, capability) => {
      assertProviderCapability(CUSTOM_OPENAI_PROVIDER, capability)
      if (capability !== 'vision') return profile.textModel
      // 视觉模型留空表示该端点没有被证明能接受图像输入。这里显式拒绝，让分镜验收
      // 的路由在保存时就拿到 422，而不是等到 FINALIZE 阶段才失败。
      if (!profile.visionModel) {
        throw new RouteContractError(
          'OpenAI 兼容模型服务尚未配置视觉模型，无法承担视觉路由',
        )
      }
      return profile.visionModel
    },
  }
}

function geminiDefaults(
  config: Awaited<ReturnType<typeof getGeminiConfig>>,
): ProviderDefaults {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelFor: (target, capability) => {
      assertProviderCapability('gemini', capability)
      // project-plan 是全片规划与编排，用更快的档位；其余文本与视觉任务用主力档位。
      return capability === 'vision' ||
        target.domain === 'media' ||
        target.kind !== 'project-plan'
        ? config.primaryModel
        : config.fastModel
    },
  }
}
