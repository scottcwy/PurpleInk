import 'server-only'
import { z } from 'zod'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { CanvasNodeType } from '@/features/canvas'
import type { AiTaskKind } from '@/features/routing'
import { type AiConfigDependencies, getAiConfigDependencies } from './config'
import { isProviderAvailable } from './provider-breaker'
import { providerDefaults } from './route-provider-defaults'
import {
  authorizeManagedRoute,
  isManagedProvider,
  type ManagedPlanKey,
  type ManagedRouteAuthorization,
} from './managed-service'
import { resolveAuthorizedFallback } from './managed-fallback'
import {
  AI_PROVIDER_IDS,
  assertProviderCapability,
  type AiProviderId,
  type ProviderCapability,
} from './provider-registry'
import {
  ROUTE_TARGET,
  capabilityForTarget,
  targetKey,
  type AiRouteTarget,
  type RouteTarget,
} from './route-target'

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

/**
 * 默认供应商按**路由任务**声明，不按节点类型。
 *
 * 路由行本身就是 per task kind（`model_routes.ai_task_kind` /
 * `media_routes.media_task_kind`）。一旦按节点类型声明默认值，同一条路由就会有
 * 多个互相矛盾的默认值，设置页展示与实际执行必然分叉。
 */
const DEFAULT_AI_PROVIDER: Record<AiTaskKind, AiProviderId> = {
  'project-plan': 'gemini',
  'shot-spec': 'gemini',
  fabricate: 'gemini',
  'vision-qa': 'gemini',
}

const DEFAULT_MEDIA_PROVIDER: Record<'tts' | 'asr', AiProviderId> = {
  tts: 'stepfun',
  asr: 'stepfun',
}

/**
 * 媒体泳道节点的 Director 会话文本任务。
 *
 * `shot-sfx` / `shot-subtitle` 同时承担两个职责：LLM 会话产出音效清单与字幕规划
 * （落 `director-assemble` 产物），媒体路由负责真实 TTS / ASR 调用。会话必须拿到
 * 文本模型，归到与同阶段全局节点 `score` 相同的 `project-plan` 文本路由。
 *
 * 真实事故：曾对媒体域节点在解析会话模型时直接抛错，音效与字幕通道全线失败。
 */
const MEDIA_LANE_SESSION_TASK = 'project-plan' satisfies AiTaskKind

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
  funding?: ManagedRouteAuthorization['funding']
  deductsManagedPool?: boolean
  /**
   * 仅在降级发生时存在：记录被熔断的主选 provider。返回值必须如实反映
   * 实际执行的备选（provider/modelId 就是备选的），降级事实通过本字段、
   * routeLabel 与 provider_fallback 日志三处可追溯；设置页展示的仍是配置真值。
   */
  degradedFrom?: AiProviderId
}

interface ResolvedRoute {
  provider: AiProviderId
  model: string
  secret: string | null
}

function sessionTarget(nodeType: CanvasNodeType): AiRouteTarget {
  const target = ROUTE_TARGET[nodeType]
  return target.domain === 'ai'
    ? target
    : { domain: 'ai', kind: MEDIA_LANE_SESSION_TASK }
}

function defaultProviderFor(
  target: RouteTarget,
  plan: ManagedPlanKey = 'free',
): AiProviderId {
  return target.domain === 'media'
    ? DEFAULT_MEDIA_PROVIDER[target.kind]
    : plan === 'free' ? 'stepfun' : DEFAULT_AI_PROVIDER[target.kind]
}

async function currentPlan(deps: AiConfigDependencies): Promise<ManagedPlanKey> {
  return deps.currentPlan ? deps.currentPlan() : 'free'
}

async function findRoute(
  target: RouteTarget,
  deps: AiConfigDependencies,
): Promise<{ provider: string; model: string } | null> {
  return target.domain === 'media'
    ? deps.mediaRoutes.find(currentWorkspaceId(), target.kind)
    : deps.modelRoutes.find(currentWorkspaceId(), target.kind)
}

async function resolveRoute(
  target: RouteTarget,
  deps: AiConfigDependencies,
): Promise<ResolvedRoute | null> {
  const stored = await findRoute(target, deps)
  if (!stored) return null
  const provider = providerSchema.parse(stored.provider)
  if (isManagedProvider(provider)) {
    return { provider, model: stored.model, secret: null }
  }
  const route = target.domain === 'media'
    ? await deps.mediaRoutes.resolve(currentWorkspaceId(), target.kind)
    : await deps.modelRoutes.resolve(currentWorkspaceId(), target.kind)
  if (!route) return null
  return {
    provider: providerSchema.parse(route.provider),
    model: route.model,
    secret: route.secret,
  }
}

export async function getDirectorProvider(
  nodeType: CanvasNodeType,
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<DirectorProviderView> {
  const target = ROUTE_TARGET[nodeType]
  const plan = await currentPlan(deps)
  const configured = await findRoute(target, deps)
  const provider = providerSchema.safeParse(configured?.provider)
  return provider.success
    ? { provider: provider.data, source: 'settings' }
    : { provider: defaultProviderFor(target, plan), source: 'default' }
}

/**
 * 解析 Director 会话要用的模型。
 *
 * 会话一律走**文本域**路由：媒体泳道节点的 TTS / ASR 路由只覆盖媒体调用，
 * 不能当作会话模型，也不能因此让整个节点无法执行。
 */
export async function resolveDirectorModelTarget(
  nodeType: CanvasNodeType,
  capability: ModelCapability = 'text',
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<DirectorModelTarget> {
  const target = sessionTarget(nodeType)
  const plan = await currentPlan(deps)
  const configured = await resolveRoute(target, deps)
  const primary = configured?.provider ?? defaultProviderFor(target, plan)
  if (configured) {
    await authorizeManagedRoute({
      plan,
      provider: configured.provider,
      modelId: configured.model,
      capability,
    }, deps.managedModelCatalog)
  }
  // 熔断检查必须在真正发起调用的解析处：half-open 的试探名额会被本次调用占用。
  // 健康路径完全旁路降级链：不读备选配置，也不产生 degradedFrom 字段。
  if (!isProviderAvailable(primary)) {
    return resolveAuthorizedFallback({ primary, target, capability, plan, deps })
  }
  if (configured) {
    const defaults = await providerDefaults(configured.provider, deps)
    const authorization = await authorizeManagedRoute({
      plan,
      provider: configured.provider,
      modelId: configured.model,
      capability,
    }, deps.managedModelCatalog)
    const { catalogId: _catalogId, ...publicAuthorization } = authorization
    return {
      provider: configured.provider,
      baseUrl: defaults.baseUrl,
      modelId: configured.model,
      apiKey: isManagedProvider(configured.provider)
        ? defaults.apiKey
        : configured.secret,
      ...publicAuthorization,
    }
  }
  const defaults = await providerDefaults(primary, deps)
  const modelId = defaults.modelFor(target, capability)
  const authorization = await authorizeManagedRoute({
    plan,
    provider: primary,
    modelId,
    capability,
  }, deps.managedModelCatalog)
  const { catalogId: _catalogId, ...publicAuthorization } = authorization
  return {
    provider: primary,
    baseUrl: defaults.baseUrl,
    modelId,
    apiKey: defaults.apiKey,
    ...publicAuthorization,
  }
}

export async function describeDirectorRoutes(
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<Record<CanvasNodeType, DirectorRouteView>> {
  const plan = await currentPlan(deps)
  const entries = await Promise.all(DIRECTOR_NODE_TYPES.map(async (nodeType) => {
    const target = ROUTE_TARGET[nodeType]
    const [provider, configured] = await Promise.all([
      getDirectorProvider(nodeType, deps),
      findRoute(target, deps),
    ])
    const model = configured?.model ?? await defaultModel(provider.provider, target, plan, deps)
    await authorizeManagedRoute({
      plan,
      provider: provider.provider,
      modelId: model,
      capability: capabilityForTarget(target),
    }, deps.managedModelCatalog)
    return [nodeType, { ...provider, model }] as const
  }))
  return Object.fromEntries(entries) as Record<CanvasNodeType, DirectorRouteView>
}

export type DirectorRouteSettingsInput = Partial<
  Record<CanvasNodeType, AiProviderId>
>

export async function saveDirectorRoutes(
  input: DirectorRouteSettingsInput,
  deps: AiConfigDependencies = getAiConfigDependencies(),
): Promise<void> {
  const plan = await currentPlan(deps)
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
    selected.set(targetKey(target), { target, provider: parsedProvider })
  }
  const planned = await Promise.all(
    [...selected.values()].map(async ({ target, provider }) => ({
      target,
      provider,
      model: await defaultModel(provider, target, plan, deps),
    }))
  )
  await Promise.all(planned.map(async ({ target, provider, model }) => {
    if (target.domain === 'media') {
      await deps.mediaRoutes.save({
        workspaceId: currentWorkspaceId(),
        mediaTaskKind: target.kind,
        provider,
        model,
      })
      return
    }
    await deps.modelRoutes.save({
      workspaceId: currentWorkspaceId(),
      aiTaskKind: target.kind,
      provider,
      model,
    })
  }))
}

async function defaultModel(
  provider: AiProviderId,
  target: RouteTarget,
  plan: ManagedPlanKey,
  deps: AiConfigDependencies,
): Promise<string> {
  const defaults = await providerDefaults(provider, deps)
  const capability = capabilityForTarget(target)
  const model = defaults.modelFor(target, capability)
  await authorizeManagedRoute(
    { plan, provider, modelId: model, capability },
    deps.managedModelCatalog,
  )
  return model
}
