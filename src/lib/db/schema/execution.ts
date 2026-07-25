import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
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
import { projects, type VersionedPayload, workspaces } from './core'

export const RUN_STATUSES = [
  'triggering',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const

export const ATTEMPT_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
] as const

export const COMMAND_RECEIPT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
] as const

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    projectId: uuid('project_id').notNull(),
    triggerRunId: text('trigger_run_id'),
    status: text('status').default('triggering').notNull(),
    workflowVersion: text('workflow_version').notNull(),
    fingerprint: text('fingerprint').notNull(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'pipeline_runs_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'pipeline_runs_project_fk',
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete('cascade'),
    unique('pipeline_runs_trigger_run_unique').on(
      table.workspaceId,
      table.triggerRunId,
    ),
    check(
      'pipeline_runs_status_check',
      sql`${table.status} in (
        'triggering', 'queued', 'running', 'succeeded', 'failed', 'cancelled'
      )`,
    ),
    check('pipeline_runs_revision_check', sql`${table.revision} >= 0`),
    check(
      'pipeline_runs_fingerprint_check',
      sql`length(${table.fingerprint}) = 64`,
    ),
  ],
)

export const taskAttempts = pgTable(
  'task_attempts',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    runId: uuid('run_id').notNull(),
    taskId: text('task_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    status: text('status').default('queued').notNull(),
    fingerprint: text('fingerprint').notNull(),
    checkpoint: jsonb('checkpoint').$type<VersionedPayload>().notNull(),
    failure: jsonb('failure').$type<VersionedPayload>(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'task_attempts_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'task_attempts_run_fk',
      columns: [table.workspaceId, table.runId],
      foreignColumns: [pipelineRuns.workspaceId, pipelineRuns.id],
    }).onDelete('cascade'),
    unique('task_attempts_identity_unique').on(
      table.workspaceId,
      table.runId,
      table.taskId,
      table.entityType,
      table.entityId,
      table.attemptNo,
    ),
    check(
      'task_attempts_status_check',
      sql`${table.status} in (
        'queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded'
      )`,
    ),
    check('task_attempts_attempt_no_check', sql`${table.attemptNo} > 0`),
    check('task_attempts_revision_check', sql`${table.revision} >= 0`),
    check(
      'task_attempts_fingerprint_check',
      sql`length(${table.fingerprint}) = 64`,
    ),
  ],
)

export const commandReceipts = pgTable(
  'command_receipts',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    command: text('command').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').default('pending').notNull(),
    result: jsonb('result').$type<VersionedPayload>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: 'command_receipts_pkey',
      columns: [table.workspaceId, table.id],
    }),
    unique('command_receipts_idempotency_key_unique').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    check(
      'command_receipts_status_check',
      sql`${table.status} in ('pending', 'succeeded', 'failed')`,
    ),
    check(
      'command_receipts_fingerprint_check',
      sql`length(${table.fingerprint}) = 64`,
    ),
  ],
)
