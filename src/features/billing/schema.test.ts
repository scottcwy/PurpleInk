import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  managedModelCatalog,
  rateCardUnits,
  rateCards,
  redemptionAudits,
  redemptionBatches,
  redemptionCodes,
  usagePeriods,
  workspaceEntitlements,
} from '@/lib/db/schema/billing'
import {
  aiInvocations,
} from '@/lib/db/schema/ai'
import {
  billingReservations,
  entitlementLedgerEntries,
  officialCostEntries,
} from '@/lib/db/schema/billing-ledger'

describe('billing schema contract', () => {
  it('stores all monetary ledger values as bigint', () => {
    const period = getTableColumns(usagePeriods)
    const rate = getTableColumns(rateCardUnits)
    expect(period.limitCnyMicros.dataType).toBe('bigint')
    expect(period.usedCnyMicros.dataType).toBe('bigint')
    expect(period.reservedCnyMicros.dataType).toBe('bigint')
    expect(rate.unitPriceCnyMicros.dataType).toBe('bigint')
  })

  it('contains entitlement, managed catalog and redemption ledgers', () => {
    expect(getTableColumns(workspaceEntitlements)).toHaveProperty('planKey')
    expect(getTableColumns(managedModelCatalog)).toHaveProperty('minimumPlanKey')
    expect(getTableColumns(redemptionBatches)).toHaveProperty('planKey')
    expect(getTableColumns(redemptionCodes)).toHaveProperty('codeHash')
    expect(getTableColumns(redemptionAudits)).toHaveProperty('result')
    expect(getTableColumns(redemptionAudits)).toHaveProperty('requestFingerprint')
    expect(getTableColumns(rateCards)).toHaveProperty('fxCnyMicrosPerCurrencyUnit')
  })

  it('stores versioned reservation, official cost and entitlement ledgers', () => {
    const period = getTableColumns(usagePeriods)
    expect(period).toHaveProperty('planVersion')
    expect(period).toHaveProperty('concurrencyLimit')
    expect(period).toHaveProperty('managedProviders')

    const invocation = getTableColumns(aiInvocations)
    expect(invocation).toHaveProperty('attemptGroupId')
    expect(invocation).toHaveProperty('deploymentId')
    expect(invocation).toHaveProperty('officialPriceIdentity')
    expect(invocation).toHaveProperty('measurementQuality')

    expect(getTableColumns(billingReservations)).toHaveProperty('maximumCnyMicros')
    expect(getTableColumns(officialCostEntries)).toHaveProperty('sourceAmountMicros')
    expect(getTableColumns(entitlementLedgerEntries)).toHaveProperty('debitCnyMicros')
  })

  it('extends invocations with reservation and immutable settlement fields', () => {
    const columns = getTableColumns(aiInvocations)
    expect(columns).toHaveProperty('usagePeriodId')
    expect(columns).toHaveProperty('rateCardId')
    expect(columns).toHaveProperty('billingIdempotencyKey')
    expect(columns).toHaveProperty('reservedCnyMicros')
    expect(columns).toHaveProperty('settledCnyMicros')
    expect(columns).toHaveProperty('usageStatus')
  })
})
