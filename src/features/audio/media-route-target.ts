import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import {
  type AiConfigDependencies,
} from '@/features/ai/config'
import {
  freezeResolvedExecutionPlanV2,
  type AdapterProtocol,
  type ResolvedExecutionPlanV2,
} from '@/features/ai/execution-plan'
import { resolveBuiltInModelTarget } from '@/features/ai/built-in-model-target'
import { providerDefaults } from '@/features/ai/route-provider-defaults'
import { RouteContractError } from '@/features/ai/route-contract-error'
import {
  CUSTOM_ASR_PROVIDER,
  CUSTOM_TTS_PROVIDER,
} from '@/features/ai/provider-registry'
import type {
  OpenAiCompatibleAsrProfile,
  OpenAiCompatibleTtsProfile,
} from '@/features/ai/openai-compatible-payloads'

export { CUSTOM_ASR_PROVIDER, CUSTOM_TTS_PROVIDER }

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
  resolvedPlan: ResolvedExecutionPlanV2
  customAudioProfile?: OpenAiCompatibleTtsProfile | OpenAiCompatibleAsrProfile
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
    return customTarget(provider, kind, deps)
  }
  return builtInTarget(provider, route.model, kind, deps)
}

async function defaultStepfunTarget(
  kind: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<MediaRouteTarget> {
  return builtInTarget('stepfun', undefined, kind, deps)
}

async function builtInTarget(
  provider: 'stepfun' | 'mimo',
  logicalModelId: string | undefined,
  capability: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<MediaRouteTarget> {
  const target = await resolveBuiltInModelTarget({
    provider,
    ...(logicalModelId ? { logicalModelId } : {}),
    capability,
    plan: deps.currentPlan ? await deps.currentPlan() : 'free',
    deps,
  })
  return {
    provider,
    model: target.modelId,
    logicalModelId: target.logicalModelId,
    deploymentId: target.deploymentId,
    channelId: target.channelId,
    adapterProtocol: target.adapterProtocol,
    officialPriceIdentity: target.officialPriceIdentity,
    providerPoolId: target.providerPoolId,
    failureDomainId: target.failureDomainId,
    resolvedPlan: target.resolvedPlan,
  }
}

async function customTarget(
  provider: typeof CUSTOM_TTS_PROVIDER | typeof CUSTOM_ASR_PROVIDER,
  capability: 'tts' | 'asr',
  deps: AiConfigDependencies,
): Promise<MediaRouteTarget> {
  const defaults = await providerDefaults(provider, deps)
  const model = defaults.modelFor({ domain: 'media', kind: capability }, capability)
  if (!defaults.apiKey) throw new RouteContractError('自定义音频端点尚未配置 API Key')
  if (!defaults.audioProfile) {
    throw new RouteContractError('自定义音频端点配置快照缺失')
  }
  const workspaceId = currentWorkspaceId()
  const routeIdentity = `${workspaceId}:${provider}`
  const planVersion = 'workspace-route/v1'
  const resolvedPlan = freezeResolvedExecutionPlanV2({
    schemaVersion: 2,
    kind: 'custom',
    providerId: provider,
    fundingSource: 'custom',
    logicalModelId: model,
    outboundModelId: model,
    deploymentId: `workspace.${provider}.${capability}`,
    channelId: `workspace.${provider}`,
    adapterProtocol: 'openai-completions',
    baseUrl: defaults.baseUrl,
    officialPriceIdentity: `custom.${provider}.${model}`,
    providerPoolId: routeIdentity,
    failureDomainId: routeIdentity,
    capability,
    planVersion,
    credentialLease: {
      source: 'custom',
      reference: `workspace-credential:${provider}`,
      version: planVersion,
      credential: defaults.apiKey,
    },
  })
  return {
    provider,
    model,
    logicalModelId: model,
    deploymentId: resolvedPlan.deploymentId,
    channelId: resolvedPlan.channelId,
    adapterProtocol: resolvedPlan.adapterProtocol,
    officialPriceIdentity: resolvedPlan.officialPriceIdentity,
    providerPoolId: resolvedPlan.providerPoolId,
    failureDomainId: resolvedPlan.failureDomainId,
    resolvedPlan,
    customAudioProfile: Object.freeze({ ...defaults.audioProfile }),
  }
}
