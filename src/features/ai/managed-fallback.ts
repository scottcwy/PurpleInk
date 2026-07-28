import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import type { AiConfigDependencies } from './config'
import {
  authorizeManagedRoute,
  filterAuthorizedFallbacks,
  type ManagedPlanKey,
} from './managed-service'
import { isProviderAvailable } from './provider-breaker'
import { ProviderUnavailableError } from './provider-unavailable-error'
import { providerDefaults } from './route-provider-defaults'
import { providerSupports, type AiProviderId } from './provider-registry'
import type { AiRouteTarget } from './route-target'
import type { DirectorModelTarget, ModelCapability } from './model-routing'

/**
 * 保守降级：只使用显式配置、当前套餐授权且健康的候选，不会擅自新增 provider。
 */
export async function resolveAuthorizedFallback(input: {
  primary: AiProviderId
  target: AiRouteTarget
  capability: ModelCapability
  plan: ManagedPlanKey
  deps: AiConfigDependencies
}): Promise<DirectorModelTarget> {
  const fallback =
    (await input.deps.fallbackProviders?.find(currentWorkspaceId())) ?? null
  const [authorizedFallback] = fallback
    ? filterAuthorizedFallbacks({
        plan: input.plan,
        capability: input.capability,
        candidates: [fallback],
      })
    : []
  if (
    !fallback ||
    fallback === input.primary ||
    !authorizedFallback ||
    !providerSupports(authorizedFallback, input.capability) ||
    !isProviderAvailable(authorizedFallback)
  ) {
    throw new ProviderUnavailableError()
  }
  const defaults = await providerDefaults(authorizedFallback, input.deps)
  if (!defaults.apiKey) throw new ProviderUnavailableError()
  const modelId = defaults.modelFor(input.target, input.capability)
  const authorization = authorizeManagedRoute({
    plan: input.plan,
    provider: authorizedFallback,
    modelId,
    capability: input.capability,
  })
  console.warn('[ai] provider_fallback', {
    from: input.primary,
    to: authorizedFallback,
  })
  return {
    provider: authorizedFallback,
    baseUrl: defaults.baseUrl,
    modelId,
    apiKey: defaults.apiKey,
    ...authorization,
    degradedFrom: input.primary,
  }
}
