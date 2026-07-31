import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { describeLaneQuotas } from '@/lib/queue/runtime-config'
import { getAiConfigDependencies } from './config'
import { describeDirectorRoutes } from './model-routing'
import {
  describeAsrProfile,
  describeTtsProfile,
} from './openai-compatible-audio-config'
import { describeOpenAiCompatibleProfile } from './openai-compatible-config'
import { resolveManagedCredential } from './managed-credentials'
import { managedModelCatalogRepository } from './managed-model-catalog-repository'
import { MANAGED_PROVIDER_IDS, type ManagedProviderId } from './managed-service'
import { resolveProviderFunding } from './config'
import {
  audioDependencies,
  customOpenAiDependencies,
} from './provider-settings-dependencies'
import { subscriptionConcurrencyLimit } from '@/features/billing/domain'
import {
  minimumPlanForManagedProvider,
  planCanUseManagedProvider,
} from '@/features/billing/domain'
import { AI_PUBLIC_CATALOG } from '@/lib/config/generated/ai-public-catalog'

/**
 * GET 与 POST 共用的无 secret 投影。
 *
 * 两侧必须同源：曾经 GET 与 POST 各写一份九项并行读，任何一侧漏加字段就会出现
 * 「保存后 UI 看到的和刷新后看到的不一样」。这里也是唯一确保不回传任何 secret 的地方。
 */
export async function describeProviderSettings() {
  const dependencies = getAiConfigDependencies()
  const plan = dependencies.currentPlan ? await dependencies.currentPlan() : 'free'
  const managedCredential = (provider: ManagedProviderId) => ({
    configured: resolveManagedCredential(provider) !== null,
    verifiedAt: null,
    updatedAt: null,
    managed: true as const,
  })
  const [
    managedCatalog,
    routes,
    laneQuotas,
    customOpenAi,
    customOpenAiTts,
    customOpenAiAsr,
    fundingEntries,
    byokCredentialEntries,
  ] = await Promise.all([
    managedModelCatalogRepository.listEnabled(),
    describeDirectorRoutes(),
    describeLaneQuotas(),
    describeOpenAiCompatibleProfile(customOpenAiDependencies()),
    describeTtsProfile(audioDependencies()),
    describeAsrProfile(audioDependencies()),
    Promise.all(MANAGED_PROVIDER_IDS.map(async (provider) => [
      provider,
      await resolveProviderFunding(provider, dependencies),
    ] as const)),
    Promise.all(MANAGED_PROVIDER_IDS.map(async (provider) => [
      provider,
      await dependencies.credentials.describe(currentWorkspaceId(), provider),
    ] as const)),
  ])
  const fundingByProvider = Object.fromEntries(fundingEntries)
  const byokByProvider = Object.fromEntries(byokCredentialEntries)
  return {
    planKey: plan,
    shotConcurrency: {
      planKey: plan,
      limit: subscriptionConcurrencyLimit(plan),
    },
    managedProviders: MANAGED_PROVIDER_IDS.map((provider) => ({
      provider,
      funding: fundingByProvider[provider],
      managedAllowed: planCanUseManagedProvider(plan, provider),
      minimumManagedPlan: minimumPlanForManagedProvider(provider),
      configured: fundingByProvider[provider] === 'managed'
        ? managedCredential(provider).configured
        : byokByProvider[provider].configured,
      managedConfigured: managedCredential(provider).configured,
      byokCredential: byokByProvider[provider],
      models: managedCatalog.filter((model) =>
        model.provider === provider
        && (
          fundingByProvider[provider] === 'byok'
          || planCanUse(plan, model.minimumPlanKey)
        )).map((model) => ({
          ...model,
          verifiedCapabilities: verifiedCapabilities(
            provider,
            model.modelId,
            fundingByProvider[provider],
          ),
        })),
    })),
    availableCatalog: managedCatalog.filter((model) =>
      fundingByProvider[model.provider] === 'byok'
      || planCanUse(plan, model.minimumPlanKey)).map((model) => ({
      ...model,
      verifiedCapabilities: verifiedCapabilities(
        model.provider,
        model.modelId,
        fundingByProvider[model.provider],
      ),
    })),
    routes,
    // ISSUE-011: 队列并发配额真值。优先级 DB > env > 代码默认，由 `runtime-config.ts` 统一提供。
    // `source = 'settings' | 'env' | 'default'` 让 UI 能透出真值来自哪里。
    laneQuotas,
    customOpenAi,
    customOpenAiTts,
    customOpenAiAsr,
  }
}

function verifiedCapabilities(
  provider: ManagedProviderId,
  logicalModelId: string,
  funding: 'managed' | 'byok',
) {
  const deployment = AI_PUBLIC_CATALOG.deployments.find((candidate) =>
    candidate.providerId === provider
    && candidate.logicalModelId === logicalModelId
    && candidate.funding === funding)
  return deployment ? [...deployment.verifiedCapabilities] : []
}

function planCanUse(
  plan: 'free' | 'plus' | 'pro' | 'max',
  minimum: 'free' | 'plus' | 'pro' | 'max',
): boolean {
  const rank = { free: 0, plus: 1, pro: 2, max: 3 } as const
  return rank[plan] >= rank[minimum]
}
