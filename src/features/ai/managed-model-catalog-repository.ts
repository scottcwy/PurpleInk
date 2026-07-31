import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import type { PlanKey } from '@/features/billing'
import { getDb } from '@/lib/db/client'
import { managedModelCatalog } from '@/lib/db/schema'
import type { ProviderCapability } from './provider-registry'
import type { BuiltInProviderId } from '@/lib/config/generated/ai-billing-manifest'

export interface ManagedModelDefinition {
  id: string
  provider: BuiltInProviderId
  modelId: string
  capabilities: readonly ProviderCapability[]
  minimumPlanKey: PlanKey
  enabled: boolean
}

export interface ManagedModelCatalogRepository {
  find(input: {
    provider: string
    modelId: string
    capability: ProviderCapability
  }): Promise<ManagedModelDefinition | null>
  listEnabled(): Promise<ManagedModelDefinition[]>
}

type CatalogRow = typeof managedModelCatalog.$inferSelect

function toDefinition(row: CatalogRow): ManagedModelDefinition {
  return {
    id: row.id,
    provider: row.provider as ManagedModelDefinition['provider'],
    modelId: row.model,
    capabilities: [row.capability as ProviderCapability],
    minimumPlanKey: row.minimumPlanKey as PlanKey,
    enabled: row.enabled,
  }
}

export class PostgresManagedModelCatalogRepository
implements ManagedModelCatalogRepository {
  async find(input: {
    provider: string
    modelId: string
    capability: ProviderCapability
  }): Promise<ManagedModelDefinition | null> {
    const database = await getDb()
    const [row] = await database.select().from(managedModelCatalog).where(and(
      eq(managedModelCatalog.provider, input.provider),
      eq(managedModelCatalog.model, input.modelId),
      eq(managedModelCatalog.capability, input.capability),
      eq(managedModelCatalog.enabled, true),
    )).limit(1)
    return row ? toDefinition(row) : null
  }

  async listEnabled(): Promise<ManagedModelDefinition[]> {
    const database = await getDb()
    const rows = await database.select().from(managedModelCatalog)
      .where(eq(managedModelCatalog.enabled, true))
      .orderBy(
        asc(managedModelCatalog.provider),
        asc(managedModelCatalog.model),
        asc(managedModelCatalog.capability),
      )
    const grouped = new Map<string, ManagedModelDefinition>()
    for (const row of rows) {
      const key = `${row.provider}:${row.model}`
      const current = grouped.get(key)
      if (!current) {
        grouped.set(key, toDefinition(row))
        continue
      }
      grouped.set(key, {
        ...current,
        capabilities: [
          ...current.capabilities,
          row.capability as ProviderCapability,
        ],
      })
    }
    return [...grouped.values()]
  }
}

export const managedModelCatalogRepository =
  new PostgresManagedModelCatalogRepository()
