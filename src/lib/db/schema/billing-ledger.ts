import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { aiInvocations } from './ai'
import {
  rateCards,
  serviceMultiplierCards,
  usagePeriods,
} from './billing'
import { type VersionedPayload, workspaces } from './core'

export const billingReservations = pgTable(
  'billing_reservations',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    invocationId: uuid('invocation_id').notNull(),
    usagePeriodId: uuid('usage_period_id').notNull(),
    maximumCnyMicros: bigint('maximum_cny_micros', { mode: 'bigint' }).notNull(),
    status: text('status').default('reserved').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).defaultNow().notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'billing_reservations_pkey',
      columns: [table.workspaceId, table.invocationId],
    }),
    foreignKey({
      name: 'billing_reservations_invocation_fk',
      columns: [table.workspaceId, table.invocationId],
      foreignColumns: [aiInvocations.workspaceId, aiInvocations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'billing_reservations_period_fk',
      columns: [table.workspaceId, table.usagePeriodId],
      foreignColumns: [usagePeriods.workspaceId, usagePeriods.id],
    }).onDelete('restrict'),
    unique('billing_reservations_idempotency_unique').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check('billing_reservations_amount_check', sql`${table.maximumCnyMicros} >= 0`),
    check(
      'billing_reservations_status_check',
      sql`${table.status} in ('reserved', 'settled', 'released', 'uncertain')`,
    ),
  ],
)

export const officialCostEntries = pgTable(
  'official_cost_entries',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    invocationId: uuid('invocation_id').notNull(),
    rateCardId: uuid('rate_card_id')
      .notNull()
      .references(() => rateCards.id, { onDelete: 'restrict' }),
    officialPriceIdentity: text('official_price_identity').notNull(),
    currency: text('currency').notNull(),
    sourceAmountMicros: bigint('source_amount_micros', { mode: 'bigint' }),
    fxRateVersion: text('fx_rate_version'),
    cnyMicros: bigint('cny_micros', { mode: 'bigint' }),
    measurementQuality: text('measurement_quality').notNull(),
    usage: jsonb('usage').$type<VersionedPayload>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'official_cost_entries_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'official_cost_entries_invocation_fk',
      columns: [table.workspaceId, table.invocationId],
      foreignColumns: [aiInvocations.workspaceId, aiInvocations.id],
    }).onDelete('restrict'),
    unique('official_cost_entries_invocation_unique').on(
      table.workspaceId,
      table.invocationId,
    ),
    check(
      'official_cost_entries_quality_check',
      sql`${table.measurementQuality} in ('reported', 'estimated', 'uncertain', 'legacy_unknown')`,
    ),
    check(
      'official_cost_entries_amount_check',
      sql`(${table.sourceAmountMicros} is null or ${table.sourceAmountMicros} >= 0)
        and (${table.cnyMicros} is null or ${table.cnyMicros} >= 0)`,
    ),
  ],
)

export const entitlementLedgerEntries = pgTable(
  'entitlement_ledger_entries',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    invocationId: uuid('invocation_id').notNull(),
    usagePeriodId: uuid('usage_period_id').notNull(),
    serviceMultiplierId: text('service_multiplier_id')
      .notNull()
      .references(() => serviceMultiplierCards.id, { onDelete: 'restrict' }),
    multiplierNumerator: bigint('multiplier_numerator', { mode: 'bigint' }).notNull(),
    multiplierDenominator: bigint('multiplier_denominator', { mode: 'bigint' }).notNull(),
    debitCnyMicros: bigint('debit_cny_micros', { mode: 'bigint' }).notNull(),
    entryType: text('entry_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'entitlement_ledger_entries_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'entitlement_ledger_entries_invocation_fk',
      columns: [table.workspaceId, table.invocationId],
      foreignColumns: [aiInvocations.workspaceId, aiInvocations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'entitlement_ledger_entries_period_fk',
      columns: [table.workspaceId, table.usagePeriodId],
      foreignColumns: [usagePeriods.workspaceId, usagePeriods.id],
    }).onDelete('restrict'),
    unique('entitlement_ledger_entries_invocation_unique').on(
      table.workspaceId,
      table.invocationId,
    ),
    unique('entitlement_ledger_entries_idempotency_unique').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check(
      'entitlement_ledger_entries_amount_check',
      sql`${table.debitCnyMicros} >= 0
        and ${table.multiplierNumerator} >= 0
        and ${table.multiplierDenominator} > 0`,
    ),
    check(
      'entitlement_ledger_entries_type_check',
      sql`${table.entryType} in ('debit', 'release', 'uncertain')`,
    ),
  ],
)
