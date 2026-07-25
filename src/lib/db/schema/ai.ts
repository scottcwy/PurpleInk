import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  customType,
  foreignKey,
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
  ],
)
