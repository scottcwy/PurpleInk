import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aiInvocations,
  entitlementLedgerEntries,
  managedModelCatalog,
  officialCostEntries,
  rateCards,
  serviceMultiplierCards,
  usagePeriods,
  workspaces,
} from '@/lib/db/schema'
import { createPgTestDatabase, type PgTestDatabase } from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
})
afterAll(async () => database.close())

describe('admin AI audit PostgreSQL projection', () => {
  it('uses v3 invocation identity and the two canonical cost ledgers', async () => {
    const [workspace] = await database.db.insert(workspaces).values({
      slug: 'admin-ai-test',
      name: 'Admin AI Test',
    }).returning({ id: workspaces.id })
    const [catalog] = await database.db.insert(managedModelCatalog).values({
      provider: 'safe-provider',
      model: 'outbound-model',
      capability: 'text',
      minimumPlanKey: 'free',
    }).returning({ id: managedModelCatalog.id })
    if (!workspace || !catalog) throw new Error('seed catalog failed')
    const now = new Date()
    const [rateCard] = await database.db.insert(rateCards).values({
      catalogId: catalog.id,
      version: 1,
      priceCurrency: 'CNY',
      fxCnyMicrosPerCurrencyUnit: BigInt(1_000_000),
      effectiveAt: now,
    }).returning({ id: rateCards.id })
    const [usagePeriod] = await database.db.insert(usagePeriods).values({
      workspaceId: workspace.id,
      planKey: 'free',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 86_400_000),
      limitCnyMicros: BigInt(1_000_000),
    }).returning({ id: usagePeriods.id })
    await database.db.insert(serviceMultiplierCards).values({
      id: 'text-v1',
      capability: 'text',
      numerator: BigInt(1),
      denominator: BigInt(1),
      effectiveFrom: now,
    })
    if (!rateCard || !usagePeriod) throw new Error('seed billing catalog failed')
    const [invocation] = await database.db.insert(aiInvocations).values({
      workspaceId: workspace.id,
      invocationNo: 1,
      status: 'succeeded',
      provider: 'safe-provider',
      model: 'outbound-model',
      logicalModelId: 'director-text',
      outboundModelId: 'outbound-model',
      deploymentId: 'production-a',
      channelId: 'managed',
      adapterProtocol: 'responses',
      officialPriceIdentity: 'official-price-v1',
      providerPoolId: 'pool-a',
      failureDomainId: 'safe-provider:text',
      planVersion: 'free.v1',
      funding: 'managed',
      telemetryVersion: 3,
      usagePeriodId: usagePeriod.id,
      rateCardId: rateCard.id,
      billingStatus: 'settled',
      completedAt: now,
    }).returning({ id: aiInvocations.id })
    if (!invocation) throw new Error('seed invocation failed')
    await database.db.insert(officialCostEntries).values({
      workspaceId: workspace.id,
      invocationId: invocation.id,
      rateCardId: rateCard.id,
      officialPriceIdentity: 'official-price-v1',
      currency: 'CNY',
      cnyMicros: BigInt(12_500),
      measurementQuality: 'reported',
    })
    await database.db.insert(entitlementLedgerEntries).values({
      workspaceId: workspace.id,
      invocationId: invocation.id,
      usagePeriodId: usagePeriod.id,
      serviceMultiplierId: 'text-v1',
      multiplierNumerator: BigInt(1),
      multiplierDenominator: BigInt(1),
      debitCnyMicros: BigInt(15_000),
      entryType: 'debit',
      idempotencyKey: 'admin-ai-test-ledger',
    })

    const { getAdminAiAudit } = await import('./ai-audit-repository')
    const snapshot = await getAdminAiAudit(7)

    expect(snapshot.items).toEqual([expect.objectContaining({
      logicalModelId: 'director-text',
      outboundModelId: 'outbound-model',
      deploymentId: 'production-a',
      channelId: 'managed',
      funding: 'managed',
      failureDomainId: 'safe-provider:text',
      invocationCount: 1,
      officialCostCnyMicros: '12500',
      entitlementDebitCnyMicros: '15000',
    })])
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain(workspace.id)
    expect(serialized).not.toContain('usage')
  })
})
