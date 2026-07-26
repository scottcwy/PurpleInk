import 'server-only'
import { z } from 'zod'
import type { CanvasNodeType } from '@/features/canvas'
import type { AiTaskKind, MediaTaskKind } from '@/features/routing'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  type AiConfigDependencies,
  getAiConfigDependencies,
  getStepfunConfig,
} from './config'
import { getGeminiConfig } from './gemini-config'
import { getMimoConfig } from './mimo-config'
import { CUSTOM_OPENAI_PROVIDER } from './openai-compatible-config'
import {
  AI_PROVIDER_IDS,
  assertProviderCapability,
  type AiProviderId,
  type ProviderCapability,
} from './provider-registry'

export { AI_PROVIDER_IDS, type AiProviderId }
export type ModelCapability = Extract<ProviderCapability, 'text' | 'vision'>

export const DIRECTOR_NODE_TYPES = [
  'script-import',
  'shot-split',
  'score',
  'export',
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
] as const satisfies readonly CanvasNodeType[]

const providerSchema = z.enum(AI_PROVIDER_IDS)
const DEFAULT_PROVIDER: Record<CanvasNodeType, AiProviderId> = {
  'script-import': 'gemini',
  'shot-split': 'gemini',
  score: 'gemini',
  export: 'gemini',
  'shot-script': 'gemini',
  'shot-codegen': 'gemini',
  'shot-sfx': 'stepfun',
  'shot-subtitle': 'stepfun',
  'shot-qa': 'gemini',
}

type RouteTarget =
  | { domain: 'ai'; kind: AiTaskKind }
  | { domain: 'media'; kind: MediaTaskKind }

const ROUTE_TARGET: Record<CanvasNodeType, RouteTarget> = {
  'script-import': { domain: 'ai', kind: 'project-plan' },
  'shot-split': { domain: 'ai', kind: 'project-plan' },
  score: { domain: 'ai', kind: 'project-plan' },
  export: { domain: 'ai', kind: 'project-plan' },
  'shot-script': { domain: 'ai', kind: 'shot-spec' },
  'shot-codegen': { domain: 'ai', kind: 'fabricate' },
  'shot-sfx': { domain: 'media', kind: 'tts' },
  'shot-subtitle': { domain: 'media', kind: 'asr' },
  'shot-qa': { domain: 'ai', kind: 'vision-qa' },
}

export interface DirectorProviderView {
  provider: AiProviderId
  source: 'settings' | 'default'
}

export interface DirectorRouteView extends DirectorProviderView {
  model: string
}

export interface DirectorModelTarget {
  provider: AiProviderId
  baseUrl: string
  modelId: string
  apiKey: string | null
}

interface ResolvedRoute {
  provider: AiProviderId
  model: string
  secret: string | null
}

async function findRoute(
  nodeType: CanvasNodeType,
  deps: AiConfigDependencies,
): Promise<{ provider: string; model: string } | null> {
  const target = ROUTE_TARGET[nodeType]
  return target.domain === 'media'
    ? deps.mediaRoutes.find(LOCAL_WORKSPACE_ID, target.kind)
    : deps.modelRoutes.find(LOCAL_WORKSPACE_ID, target.kind)
}

async function resolveRoute(
  nodeType: CanvasNodeType,
  deps: AiConfigDependencies,
): Promise<ResolvedRoute | null> {
  const target = ROUTE_TARGET[nodeType]
  const route = target.domain === 'media'
    ? await deps.mediaRoutes.resolve(LOCAL_WORKSPACE_ID, target.kind)
    : await deps.modelRoutes.resolve(LOCAL_WORKSPACE_ID, target.kind)
  if (!route) return null
  return {
    provider: providerSchema.parse(route.provider),
    model: route.model,
    secret: route.secret,
  }
}

function capabilityForTarget(target: RouteTarget): ProviderCapability {
  if (target.domain === 'media') return target.kind
  return target.kind === 'vision-qa' ? 'vision' : 'text'
}

export async function getDirectorProvider(
  nodeType: CanvasNodeType,
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<DirectorProviderView> {
  const configured = await findRoute(nodeType, deps)
  const provider = providerSchema.safeParse(configured?.provider)
  return provider.success
    ? { provider: provider.data, source: 'settings' }
    : { provider: DEFAULT_PROVIDER[nodeType], source: 'default' }
}

async function fallbackTarget(
  provider: AiProviderId,
  nodeType: CanvasNodeType,
  capability: ModelCapability,
  deps: AiConfigDependencies,
): Promise<DirectorModelTarget> {
  if (provider === 'stepfun') {
    const config = await getStepfunConfig(deps)
    return {
      provider,
      baseUrl: config.baseUrl,
      modelId: capability === 'vision' ? config.visionModel : config.chatModel,
      apiKey: config.apiKey,
    }
  }
  if (provider === CUSTOM_OPENAI_PROVIDER) {
    const profiles = deps.openAiCompatibleProfiles
    if (!profiles) throw new Error('OpenAI 兼容模型配置存储不可用')
    const [profile, apiKey] = await Promise.all([
      profiles.find(LOCAL_WORKSPACE_ID),
      deps.credentials.loadSecret(LOCAL_WORKSPACE_ID, CUSTOM_OPENAI_PROVIDER),
    ])
    if (!profile) {
      throw new Error('OpenAI 兼容模型服务尚未配置')
    }
    return {
      provider,
      baseUrl: profile.baseUrl,
      modelId: profile.defaultModel,
      apiKey,
    }
  }
  if (provider === 'mimo') {
    const config = await getMimoConfig(deps)
    return {
      provider,
      baseUrl: config.baseUrl,
      modelId: capability === 'vision' ? config.visionModel : config.textModel,
      apiKey: config.apiKey,
    }
  }
  const config = await getGeminiConfig(deps)
  return {
    provider,
    baseUrl: config.baseUrl,
    modelId:
      capability === 'vision' || nodeType !== 'script-import'
        ? config.primaryModel
        : config.fastModel,
    apiKey: config.apiKey,
  }
}

export async function resolveDirectorModelTarget(
  nodeType: CanvasNodeType,
  capability: ModelCapability = 'text',
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<DirectorModelTarget> {
  if (ROUTE_TARGET[nodeType].domain !== 'ai') {
    throw new Error(`${nodeType} 是媒体节点，不能解析为 Director 模型`)
  }
  const configured = await resolveRoute(nodeType, deps)
  if (configured) {
    const fallback = await fallbackTarget(
      configured.provider,
      nodeType,
      capability,
      deps,
    )
    return {
      ...fallback,
      modelId: configured.model,
      apiKey: configured.secret,
    }
  }
  const { provider } = await getDirectorProvider(nodeType, deps)
  return fallbackTarget(provider, nodeType, capability, deps)
}

export async function describeDirectorRoutes(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<Record<CanvasNodeType, DirectorRouteView>> {
  const entries = await Promise.all(DIRECTOR_NODE_TYPES.map(async (nodeType) => {
    const provider = await getDirectorProvider(nodeType, deps)
    const routeTarget = ROUTE_TARGET[nodeType]
    const configured = await findRoute(nodeType, deps)
    const model = configured?.model ?? await modelForProvider(
      provider.provider,
      routeTarget,
      deps,
    )
    return [nodeType, { ...provider, model }] as const
  }))
  return Object.fromEntries(entries) as Record<CanvasNodeType, DirectorRouteView>
}

export type DirectorRouteSettingsInput = Partial<
  Record<CanvasNodeType, AiProviderId>
>

function targetKey(target: RouteTarget): string {
  return `${target.domain}:${target.kind}`
}

async function modelForProvider(
  provider: AiProviderId,
  target: RouteTarget,
  deps: AiConfigDependencies,
): Promise<string> {
  const capability = capabilityForTarget(target)
  assertProviderCapability(provider, capability)
  if (provider === 'stepfun') {
    const config = await getStepfunConfig(deps)
    if (target.domain === 'media') {
      return target.kind === 'tts' ? config.ttsModel : config.asrModel
    }
    return target.kind === 'vision-qa' ? config.visionModel : config.chatModel
  }
  if (provider === CUSTOM_OPENAI_PROVIDER) {
    const profiles = deps.openAiCompatibleProfiles
    if (!profiles) throw new Error('OpenAI 兼容模型配置存储不可用')
    const profile = await profiles.find(LOCAL_WORKSPACE_ID)
    if (!profile) throw new Error('OpenAI 兼容模型服务尚未配置')
    return profile.defaultModel
  }
  if (provider === 'mimo') {
    const config = await getMimoConfig(deps)
    if (target.domain === 'media') {
      return target.kind === 'tts' ? config.ttsModel : config.asrModel
    }
    return target.kind === 'vision-qa' ? config.visionModel : config.textModel
  }
  const config = await getGeminiConfig(deps)
  return target.domain === 'ai' && target.kind !== 'project-plan'
    ? config.primaryModel
    : config.fastModel
}

export async function saveDirectorRoutes(
  input: DirectorRouteSettingsInput,
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<void> {
  const selected = new Map<
    string,
    { target: RouteTarget; provider: AiProviderId }
  >()
  for (const nodeType of DIRECTOR_NODE_TYPES) {
    const provider = input[nodeType]
    if (provider === undefined) continue
    const target = ROUTE_TARGET[nodeType]
    const parsedProvider = providerSchema.parse(provider)
    assertProviderCapability(parsedProvider, capabilityForTarget(target))
    selected.set(targetKey(target), {
      target,
      provider: parsedProvider,
    })
  }
  await Promise.all([...selected.values()].map(async ({ target, provider }) => {
    const model = await modelForProvider(provider, target, deps)
    if (target.domain === 'media') {
      await deps.mediaRoutes.save({
        workspaceId: LOCAL_WORKSPACE_ID,
        mediaTaskKind: target.kind,
        provider,
        model,
      })
    } else {
      await deps.modelRoutes.save({
        workspaceId: LOCAL_WORKSPACE_ID,
        aiTaskKind: target.kind,
        provider,
        model,
      })
    }
  }))
}
