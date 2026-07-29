import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { artifacts } from './artifacts'
import { type VersionedPayload, workspaces } from './core'
import { pipelineRuns, taskAttempts } from './execution'
import { rateCards, usagePeriods } from './billing'

export const AI_TASK_KINDS = [
  'project-plan',
  'shot-spec',
  'fabricate',
  'vision-qa',
] as const

export const MEDIA_TASK_KINDS = ['tts', 'asr'] as const

export const AI_INVOCATION_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const

export const PROVIDER_DISPATCH_STATUSES = ['reserved', 'released'] as const

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea'
  },
})

export const modelRoutes = pgTable(
  'model_routes',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    aiTaskKind: text('ai_task_kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'model_routes_pkey',
      columns: [table.workspaceId, table.id],
    }),
    unique('model_routes_ai_task_kind_unique').on(
      table.workspaceId,
      table.aiTaskKind,
    ),
    check(
      'model_routes_ai_task_kind_check',
      sql`${table.aiTaskKind} in (
        'project-plan', 'shot-spec', 'fabricate', 'vision-qa'
      )`,
    ),
    check('model_routes_revision_check', sql`${table.revision} >= 0`),
  ],
)

export const mediaRoutes = pgTable(
  'media_routes',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    mediaTaskKind: text('media_task_kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'media_routes_pkey',
      columns: [table.workspaceId, table.id],
    }),
    unique('media_routes_media_task_kind_unique').on(
      table.workspaceId,
      table.mediaTaskKind,
    ),
    check(
      'media_routes_media_task_kind_check',
      sql`${table.mediaTaskKind} in ('tts', 'asr')`,
    ),
    check('media_routes_revision_check', sql`${table.revision} >= 0`),
  ],
)

export const providerCredentials = pgTable(
  'provider_credentials',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    provider: text('provider').notNull(),
    envelopeVersion: integer('envelope_version').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    nonce: bytea('nonce').notNull(),
    authTag: bytea('auth_tag').notNull(),
    keyVersion: text('key_version').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'provider_credentials_pkey',
      columns: [table.workspaceId, table.id],
    }),
    unique('provider_credentials_provider_unique').on(
      table.workspaceId,
      table.provider,
    ),
    check(
      'provider_credentials_envelope_version_check',
      sql`${table.envelopeVersion} > 0`,
    ),
    check(
      'provider_credentials_nonce_length_check',
      sql`octet_length(${table.nonce}) = 12`,
    ),
    check(
      'provider_credentials_auth_tag_length_check',
      sql`octet_length(${table.authTag}) = 16`,
    ),
  ],
)

export const aiInvocations = pgTable(
  'ai_invocations',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    runId: uuid('run_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    taskId: text('task_id').notNull(),
    invocationNo: integer('invocation_no').notNull(),
    repairNo: integer('repair_no').default(0).notNull(),
    status: text('status').default('running').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputHash: text('input_hash').notNull(),
    outputHash: text('output_hash'),
    usage: jsonb('usage').$type<VersionedPayload>(),
    usagePeriodId: uuid('usage_period_id'),
    rateCardId: uuid('rate_card_id').references(() => rateCards.id, {
      onDelete: 'restrict',
    }),
    billingIdempotencyKey: text('billing_idempotency_key'),
    billingStatus: text('billing_status').default('unreserved').notNull(),
    reservedCnyMicros: bigint('reserved_cny_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    settledCnyMicros: bigint('settled_cny_micros', { mode: 'bigint' }),
    usageStatus: text('usage_status'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    traceArtifactId: uuid('trace_artifact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'ai_invocations_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'ai_invocations_usage_period_fk',
      columns: [table.workspaceId, table.usagePeriodId],
      foreignColumns: [usagePeriods.workspaceId, usagePeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ai_invocations_run_fk',
      columns: [table.workspaceId, table.runId],
      foreignColumns: [pipelineRuns.workspaceId, pipelineRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ai_invocations_attempt_fk',
      columns: [table.workspaceId, table.attemptId],
      foreignColumns: [taskAttempts.workspaceId, taskAttempts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ai_invocations_trace_artifact_fk',
      columns: [table.workspaceId, table.traceArtifactId],
      foreignColumns: [artifacts.workspaceId, artifacts.id],
    }).onDelete('restrict'),
    unique('ai_invocations_provider_round_unique').on(
      table.workspaceId,
      table.attemptId,
      table.invocationNo,
      table.repairNo,
    ),
    unique('ai_invocations_billing_idempotency_unique').on(
      table.workspaceId,
      table.billingIdempotencyKey,
    ),
    check(
      'ai_invocations_status_check',
      sql`${table.status} in ('running', 'succeeded', 'failed', 'cancelled')`,
    ),
    check(
      'ai_invocations_invocation_no_check',
      sql`${table.invocationNo} > 0`,
    ),
    check(
      'ai_invocations_repair_no_check',
      sql`${table.repairNo} between 0 and 2`,
    ),
    check(
      'ai_invocations_input_hash_check',
      sql`length(${table.inputHash}) = 64`,
    ),
    check(
      'ai_invocations_output_hash_check',
      sql`${table.outputHash} is null or length(${table.outputHash}) = 64`,
    ),
    check(
      'ai_invocations_billing_status_check',
      sql`${table.billingStatus} in ('unreserved', 'reserved', 'settled', 'released')`,
    ),
    check(
      'ai_invocations_billing_amounts_check',
      sql`${table.reservedCnyMicros} >= 0
        and (${table.settledCnyMicros} is null or ${table.settledCnyMicros} >= 0)`,
    ),
    check(
      'ai_invocations_usage_status_check',
      sql`${table.usageStatus} is null or ${table.usageStatus} in ('reported', 'unavailable')`,
    ),
  ],
)

/**
 * Provider 出网预留事实。released 行继续保留用于滚动 RPM/TPM 统计；并发只统计
 * lease 尚未过期的 reserved 行。scopeKey 已包含 funding 与凭据指纹，不存 Key。
 */
export const providerDispatches = pgTable(
  'provider_dispatches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scopeKey: text('scope_key').notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    attemptId: uuid('attempt_id'),
    provider: text('provider').notNull(),
    funding: text('funding').notNull(),
    status: text('status').default('reserved').notNull(),
    tokenEstimate: integer('token_estimate').default(0).notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    index('provider_dispatches_scope_reserved_idx').on(
      table.scopeKey,
      table.reservedAt,
    ),
    index('provider_dispatches_scope_lease_idx').on(
      table.scopeKey,
      table.status,
      table.leaseExpiresAt,
    ),
    check('provider_dispatches_scope_key_check', sql`length(${table.scopeKey}) = 64`),
    check(
      'provider_dispatches_funding_check',
      sql`${table.funding} in ('managed', 'byok')`,
    ),
    check(
      'provider_dispatches_status_check',
      sql`${table.status} in ('reserved', 'released')`,
    ),
    check('provider_dispatches_token_estimate_check', sql`${table.tokenEstimate} >= 0`),
  ],
)

/** Provider 真实 429 学到的共享冷却窗口；同 scope 的所有进程在此时间前均不出网。 */
export const providerDispatchCooldowns = pgTable(
  'provider_dispatch_cooldowns',
  {
    scopeKey: text('scope_key').primaryKey(),
    provider: text('provider').notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'provider_dispatch_cooldowns_scope_key_check',
      sql`length(${table.scopeKey}) = 64`,
    ),
  ],
)
