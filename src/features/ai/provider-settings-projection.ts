import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { describeLaneQuotas } from '@/lib/queue/runtime-config'
import { describeStepfunConfig, getAiConfigDependencies } from './config'
import { describeGeminiConfig } from './gemini-config'
import { describeMimoConfig } from './mimo-config'
import { describeDirectorRoutes } from './model-routing'
import {
  describeAsrProfile,
  describeTtsProfile,
} from './openai-compatible-audio-config'
import { describeOpenAiCompatibleProfile } from './openai-compatible-config'
import { resolveManagedCredential } from './managed-credentials'
import {
  MANAGED_MODEL_CATALOG,
  MANAGED_PROVIDER_IDS,
  type ManagedProviderId,
} from './managed-service'
import {
  audioDependencies,
  customOpenAiDependencies,
} from './provider-settings-dependencies'

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
    stepfunCredential,
    geminiCredential,
    mimoCredential,
    models,
    gemini,
    mimo,
    routes,
    laneQuotas,
    customOpenAi,
    customOpenAiTts,
    customOpenAiAsr,
    fallbackProvider,
  ] = await Promise.all([
    Promise.resolve(managedCredential('stepfun')),
    Promise.resolve(managedCredential('gemini')),
    Promise.resolve(managedCredential('mimo')),
    describeStepfunConfig(),
    describeGeminiConfig(),
    describeMimoConfig(),
    describeDirectorRoutes(),
    describeLaneQuotas(),
    describeOpenAiCompatibleProfile(customOpenAiDependencies()),
    describeTtsProfile(audioDependencies()),
    describeAsrProfile(audioDependencies()),
    // 降级链备选：未配置时回 null（默认无备选）。只回 provider id，无 secret。
    dependencies.fallbackProviders?.find(currentWorkspaceId())
      ?? null,
  ])
  return {
    ...stepfunCredential,
    models,
    geminiConfigured: geminiCredential.configured,
    geminiCredential,
    gemini,
    mimoCredential,
    mimo,
    managedProviders: MANAGED_PROVIDER_IDS.map((provider) => ({
      provider,
      ...managedCredential(provider),
      models: MANAGED_MODEL_CATALOG.filter((model) =>
        model.provider === provider && !(plan === 'free' && provider === 'gemini')),
    })),
    availableCatalog: MANAGED_MODEL_CATALOG.filter((model) =>
      !(plan === 'free' && model.provider === 'gemini')),
    routes,
    // ISSUE-011: 队列并发配额真值。优先级 DB > env > 代码默认，由 `runtime-config.ts` 统一提供。
    // `source = 'settings' | 'env' | 'default'` 让 UI 能透出真值来自哪里。
    laneQuotas,
    customOpenAi,
    customOpenAiTts,
    customOpenAiAsr,
    fallbackProvider,
  }
}
