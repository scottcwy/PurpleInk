import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { PostgresDb } from '@/lib/db/client'
import type { VersionedPayload } from '@/lib/db/schema'
import { workspaceSettings } from '@/lib/db/schema'
import type { ManagedProviderId } from './managed-service'

export type ProviderFunding = 'managed' | 'byok'

export interface ProviderFundingStore {
  find(workspaceId: string, provider: ManagedProviderId): Promise<ProviderFunding>
  save(
    workspaceId: string,
    provider: ManagedProviderId,
    funding: ProviderFunding,
  ): Promise<void>
}

const SCHEMA_VERSION = 1
const payloadSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  funding: z.enum(['managed', 'byok']),
})

function settingsKey(provider: ManagedProviderId): string {
  return `ai.funding.${provider}`
}

export class PostgresProviderFundingStore implements ProviderFundingStore {
  constructor(private readonly database: () => Promise<PostgresDb>) {}

  async find(
    workspaceId: string,
    provider: ManagedProviderId,
  ): Promise<ProviderFunding> {
    const db = await this.database()
    const [row] = await db.select({ value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(and(
        eq(workspaceSettings.workspaceId, workspaceId),
        eq(workspaceSettings.key, settingsKey(provider)),
      ))
      .limit(1)
    const parsed = payloadSchema.safeParse(row?.value)
    return parsed.success ? parsed.data.funding : 'managed'
  }

  async save(
    workspaceId: string,
    provider: ManagedProviderId,
    funding: ProviderFunding,
  ): Promise<void> {
    const db = await this.database()
    const value: VersionedPayload = { schemaVersion: SCHEMA_VERSION, funding }
    await db.insert(workspaceSettings).values({
      workspaceId,
      key: settingsKey(provider),
      value,
    }).onConflictDoUpdate({
      target: [workspaceSettings.workspaceId, workspaceSettings.key],
      set: { value, updatedAt: new Date() },
    })
  }
}
