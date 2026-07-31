import 'server-only'
import {
  PostgresProviderCredentialStore,
  type ProviderCredentialStore,
} from '@/features/credentials'
import { getCurrentPlanKey, type PlanKey } from '@/features/billing'
import {
  PostgresMediaRouteRepository,
  PostgresModelRouteRepository,
} from '@/features/routing'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getDb } from '@/lib/db/client'
import {
  PostgresOpenAiCompatibleAudioProfileStore,
  type OpenAiCompatibleAudioProfileStore,
} from './openai-compatible-audio-profile-store'
import {
  PostgresOpenAiCompatibleProfileStore,
  type OpenAiCompatibleProfileStore,
} from './openai-compatible-profile-store'
import { resolveManagedCredential } from './managed-credentials'
import {
  managedModelCatalogRepository,
  type ManagedModelCatalogRepository,
} from './managed-model-catalog-repository'
import {
  PostgresProviderFundingStore,
  type ProviderFunding,
  type ProviderFundingStore,
} from './provider-funding-store'
import {
  isManagedProvider,
  type ManagedProviderId,
} from './managed-service'
import type { AiProviderId } from './provider-registry'

export interface AiConfigDependencies {
  credentials: ProviderCredentialStore
  modelRoutes: Pick<
    PostgresModelRouteRepository,
    'find' | 'remove' | 'resolve' | 'save'
  >
  mediaRoutes: Pick<
    PostgresMediaRouteRepository,
    'find' | 'remove' | 'resolve' | 'save'
  >
  openAiCompatibleProfiles?: OpenAiCompatibleProfileStore
  openAiCompatibleAudioProfiles?: OpenAiCompatibleAudioProfileStore
  /** 当前 workspace 套餐；测试可注入，默认经 billing 公共投影读取。 */
  currentPlan?: () => Promise<PlanKey>
  /** 托管模型授权目录；生产环境唯一实现读取 Postgres。 */
  managedModelCatalog?: ManagedModelCatalogRepository
  /** 内置 provider 的资金来源；缺行时保守默认平台托管。 */
  providerFunding?: ProviderFundingStore
}

const credentials = new PostgresProviderCredentialStore(getDb)
const dependencies: AiConfigDependencies = {
  credentials,
  modelRoutes: new PostgresModelRouteRepository(getDb, credentials),
  mediaRoutes: new PostgresMediaRouteRepository(getDb, credentials),
  openAiCompatibleProfiles: new PostgresOpenAiCompatibleProfileStore(getDb),
  openAiCompatibleAudioProfiles:
    new PostgresOpenAiCompatibleAudioProfileStore(getDb),
  currentPlan: getCurrentPlanKey,
  managedModelCatalog: managedModelCatalogRepository,
  providerFunding: new PostgresProviderFundingStore(getDb),
}

export function getAiConfigDependencies(): AiConfigDependencies {
  return dependencies
}

export async function resolveProviderFunding(
  provider: ManagedProviderId,
  deps: AiConfigDependencies = dependencies,
): Promise<ProviderFunding> {
  return deps.providerFunding?.find(currentWorkspaceId(), provider) ?? 'managed'
}

export async function resolveProviderApiKey(
  provider: ManagedProviderId,
  deps: AiConfigDependencies = dependencies,
): Promise<string | null> {
  const funding = await resolveProviderFunding(provider, deps)
  return funding === 'managed'
    ? resolveManagedCredential(provider)
    : deps.credentials.loadSecret(currentWorkspaceId(), provider)
}

export async function fundingForProvider(
  provider: AiProviderId,
  deps: AiConfigDependencies = dependencies,
): Promise<ProviderFunding> {
  return isManagedProvider(provider)
    ? resolveProviderFunding(provider, deps)
    : 'byok'
}
