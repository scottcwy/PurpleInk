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
import { aiInvocations } from '@/lib/db/schema/ai'

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
