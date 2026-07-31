import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  fundingForProvider,
  getStepfunConfig,
  type AiConfigDependencies,
} from '@/features/ai/config'
import { resolveDeploymentBinding } from '@/features/ai/execution-plan'
import type { AdapterProtocol } from '@/features/ai/execution-plan'

export const CUSTOM_TTS_PROVIDER = 'openai-compatible-tts' as const
export const CUSTOM_ASR_PROVIDER = 'openai-compatible-asr' as const

export type MediaProviderId =
  | 'stepfun'
  | 'mimo'
  | typeof CUSTOM_TTS_PROVIDER
  | typeof CUSTOM_ASR_PROVIDER

export interface MediaRouteTarget {
  provider: MediaProviderId
  model: string
  logicalModelId?: string
  deploymentId?: string
  channelId?: string
  adapterProtocol?: AdapterProtocol
  officialPriceIdentity?: string
  providerPoolId?: string
  failureDomainId?: string
}

const MEDIA_PROVIDERS: readonly MediaProviderId[] = [
  'stepfun',
  'mimo',
  CUSTOM_TTS_PROVIDER,
  CUSTOM_ASR_PROVIDER,
]

export function audioProfiles(deps: AiConfigDependencies) {
  const store = deps.openAiCompatibleAudioProfiles
  if (!store) throw new Error('自定义兼容音频端点配置存储不可用')
  return store
}

export async function resolveMediaRouteTarget(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<MediaRouteTarget> {
  const route = await deps.mediaRoutes.resolve(currentWorkspaceId(), kind)
  if (!route) return defaultStepfunTarget(kind, deps)
  const provider = MEDIA_PROVIDERS.find((candidate) => candidate === route.provider)
  if (!provider) throw new Error(`媒体路由供应商不受支持：${route.provider}`)
  if (provider === CUSTOM_TTS_PROVIDER || provider === CUSTOM_ASR_PROVIDER) {
    return { provider, model: await customModel(provider, deps) }
  }
  return builtInTarget(provider, route.model, kind, deps)
}

async function defaultStepfunTarget(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<MediaRouteTarget> {
  const config = await getStepfunConfig(deps)
  return builtInTarget(
    'stepfun',
    kind === 'tts' ? config.ttsModel : config.asrModel,
    kind,
    deps,
  )
}

async function builtInTarget(
  provider: 'stepfun' | 'mimo',
  logicalModelId: string,
  capability: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<MediaRouteTarget> {
  const funding = await fundingForProvider(provider, deps)
  const binding = resolveDeploymentBinding({
    providerId: provider,
    fundingSource: funding,
    capability,
    logicalModelId,
  })
  return {
    provider,
    model: binding.outboundModelId,
    logicalModelId: binding.logicalModelId,
    deploymentId: binding.deploymentId,
    channelId: binding.channelId,
    adapterProtocol: binding.adapterProtocol,
    officialPriceIdentity: binding.officialPriceIdentity,
    providerPoolId: funding === 'managed'
      ? binding.providerPoolId
      : `${currentWorkspaceId()}:${provider}`,
    failureDomainId: funding === 'managed'
      ? binding.failureDomainId
      : `${currentWorkspaceId()}:${provider}`,
  }
}

async function customModel(
  provider: typeof CUSTOM_TTS_PROVIDER | typeof CUSTOM_ASR_PROVIDER,
  deps: AiConfigDependencies,
): Promise<string> {
  const store = audioProfiles(deps)
  const profile = provider === CUSTOM_TTS_PROVIDER
    ? await store.findTts(currentWorkspaceId())
    : await store.findAsr(currentWorkspaceId())
  if (profile) return profile.model
  throw new Error(
    provider === CUSTOM_TTS_PROVIDER
      ? '自定义兼容 TTS 端点尚未配置'
      : '自定义兼容 ASR 端点尚未配置',
  )
}
