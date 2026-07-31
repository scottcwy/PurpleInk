import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { workspaces } from './core'

export const PLAN_KEYS = ['free', 'plus', 'pro', 'max'] as const
export const BILLING_STATUSES = ['active', 'closed'] as const
export const REDEMPTION_RESULTS = [
  'redeemed',
  'rejected_lower_tier',
  'unavailable',
] as const

const planCheck = (column: { name: string }) =>
  sql`${column} in ('free', 'plus', 'pro', 'max')`

export const workspaceEntitlements = pgTable(
  'workspace_entitlements',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planKey: text('plan_key').default('free').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').default('active').notNull(),
    source: text('source').default('default').notNull(),
    revision: bigint('revision', { mode: 'bigint' }).default(sql`0`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('workspace_entitlements_plan_check', planCheck(table.planKey)),
    check('workspace_entitlements_status_check', sql`${table.status} in ('active', 'expired', 'cancelled')`),
    check('workspace_entitlements_period_check', sql`${table.expiresAt} > ${table.startsAt}`),
    check('workspace_entitlements_revision_check', sql`${table.revision} >= 0`),
  ],
)

export const usagePeriods = pgTable(
  'usage_periods',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    planKey: text('plan_key').notNull(),
    planVersion: text('plan_version').default('legacy.v1').notNull(),
    concurrencyLimit: integer('concurrency_limit').default(3).notNull(),
    managedProviders: jsonb('managed_providers')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    status: text('status').default('active').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    limitCnyMicros: bigint('limit_cny_micros', { mode: 'bigint' }).notNull(),
    usedCnyMicros: bigint('used_cny_micros', { mode: 'bigint' }).default(sql`0`).notNull(),
    reservedCnyMicros: bigint('reserved_cny_micros', { mode: 'bigint' }).default(sql`0`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'usage_periods_pkey', columns: [table.workspaceId, table.id] }),
    unique('usage_periods_workspace_start_unique').on(table.workspaceId, table.startsAt),
    check('usage_periods_plan_check', planCheck(table.planKey)),
    check('usage_periods_concurrency_check', sql`${table.concurrencyLimit} > 0`),
    check('usage_periods_status_check', sql`${table.status} in ('active', 'closed')`),
    check('usage_periods_period_check', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'usage_periods_amounts_check',
      sql`${table.limitCnyMicros} >= 0 and ${table.usedCnyMicros} >= 0
        and ${table.reservedCnyMicros} >= 0
        and ${table.usedCnyMicros} + ${table.reservedCnyMicros} <= ${table.limitCnyMicros}`,
    ),
  ],
)

export const managedModelCatalog = pgTable(
  'managed_model_catalog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    capability: text('capability').notNull(),
    minimumPlanKey: text('minimum_plan_key').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('managed_model_catalog_identity_unique').on(
      table.provider,
      table.model,
      table.capability,
    ),
    check('managed_model_catalog_plan_check', planCheck(table.minimumPlanKey)),
  ],
)

export const rateCards = pgTable(
  'rate_cards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    catalogId: uuid('catalog_id')
      .notNull()
      .references(() => managedModelCatalog.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    catalogVersion: text('catalog_version'),
    officialPriceIdentity: text('official_price_identity'),
    sourceUrl: text('source_url'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }),
    fxRateVersion: text('fx_rate_version'),
    pricingRules: jsonb('pricing_rules').$type<{
      tiers: Array<{
        inputTokensAbove: number
        inputNumerator: string
        inputDenominator: string
        outputNumerator: string
        outputDenominator: string
      }>
    }>(),
    priceCurrency: text('price_currency').notNull(),
    fxCnyMicrosPerCurrencyUnit: bigint('fx_cny_micros_per_currency_unit', {
      mode: 'bigint',
    }).notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('rate_cards_catalog_version_unique').on(table.catalogId, table.version),
    check('rate_cards_version_check', sql`${table.version} > 0`),
    check('rate_cards_currency_check', sql`${table.priceCurrency} in ('CNY', 'USD')`),
    check('rate_cards_fx_check', sql`${table.fxCnyMicrosPerCurrencyUnit} > 0`),
  ],
)

export const billingFxRates = pgTable(
  'billing_fx_rates',
  {
    id: text('id').primaryKey(),
    currency: text('currency').notNull(),
    cnyMicrosPerCurrencyUnit: bigint('cny_micros_per_currency_unit', {
      mode: 'bigint',
    }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    sourceUrl: text('source_url').notNull(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('billing_fx_rates_amount_check', sql`${table.cnyMicrosPerCurrencyUnit} > 0`),
    check(
      'billing_fx_rates_period_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
)

export const serviceMultiplierCards = pgTable(
  'service_multiplier_cards',
  {
    id: text('id').primaryKey(),
    capability: text('capability').notNull(),
    numerator: bigint('numerator', { mode: 'bigint' }).notNull(),
    denominator: bigint('denominator', { mode: 'bigint' }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'service_multiplier_cards_ratio_check',
      sql`${table.numerator} >= 0 and ${table.denominator} > 0`,
    ),
    check(
      'service_multiplier_cards_period_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
)

export const rateCardUnits = pgTable(
  'rate_card_units',
  {
    rateCardId: uuid('rate_card_id')
      .notNull()
      .references(() => rateCards.id, { onDelete: 'restrict' }),
    unitKind: text('unit_kind').notNull(),
    unitSize: bigint('unit_size', { mode: 'bigint' }).notNull(),
    sourcePriceMicros: bigint('source_price_micros', { mode: 'bigint' }).notNull(),
    unitPriceCnyMicros: bigint('unit_price_cny_micros', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'rate_card_units_pkey',
      columns: [table.rateCardId, table.unitKind],
    }),
    check(
      'rate_card_units_kind_check',
      sql`${table.unitKind} in (
        'input_token', 'cached_input_token', 'cache_write_token', 'output_token',
        'tts_character', 'audio_second', 'video_second'
      )`,
    ),
    check(
      'rate_card_units_amounts_check',
      sql`${table.unitSize} > 0 and ${table.sourcePriceMicros} >= 0
        and ${table.unitPriceCnyMicros} >= 0`,
    ),
  ],
)

export const redemptionBatches = pgTable(
  'redemption_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    planKey: text('plan_key').notNull(),
    durationDays: integer('duration_days').default(30).notNull(),
    label: text('label').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('redemption_batches_plan_check', planCheck(table.planKey)),
    check('redemption_batches_duration_check', sql`${table.durationDays} = 30`),
  ],
)

export const redemptionCodes = pgTable(
  'redemption_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => redemptionBatches.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull().unique(),
    consumedByWorkspaceId: uuid('consumed_by_workspace_id').references(
      () => workspaces.id,
      { onDelete: 'restrict' },
    ),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('redemption_codes_hash_check', sql`length(${table.codeHash}) = 64`),
    check(
      'redemption_codes_consumption_check',
      sql`(${table.consumedByWorkspaceId} is null) = (${table.consumedAt} is null)`,
    ),
  ],
)

export const redemptionAudits = pgTable(
  'redemption_audits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    codeId: uuid('code_id').references(() => redemptionCodes.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    result: text('result').notNull(),
    beforePlanKey: text('before_plan_key'),
    afterPlanKey: text('after_plan_key'),
    beforeExpiresAt: timestamp('before_expires_at', { withTimezone: true }),
    afterExpiresAt: timestamp('after_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('redemption_audits_idempotency_unique').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check('redemption_audits_result_check', sql`${table.result} in (
      'redeemed', 'rejected_lower_tier', 'unavailable'
    )`),
    check(
      'redemption_audits_before_plan_check',
      sql`${table.beforePlanKey} is null or ${planCheck(table.beforePlanKey)}`,
    ),
    check(
      'redemption_audits_after_plan_check',
      sql`${table.afterPlanKey} is null or ${planCheck(table.afterPlanKey)}`,
    ),
    check('redemption_audits_fingerprint_check', sql`length(${table.requestFingerprint}) = 64`),
  ],
)
