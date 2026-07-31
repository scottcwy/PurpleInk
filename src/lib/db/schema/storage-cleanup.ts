import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { workspaces } from './core'

export const STORAGE_CLEANUP_REASONS = [
  'artifact-registration-failed',
  'duplicate-upload',
  'creation-failed',
] as const

export const storageCleanupRequests = pgTable(
  'storage_cleanup_requests',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    projectId: uuid('project_id'),
    nodeId: uuid('node_id'),
    attemptId: uuid('attempt_id'),
    reason: text('reason').notNull(),
    generation: integer('generation').default(0).notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    failureCode: text('failure_code'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'storage_cleanup_requests_pkey',
      columns: [table.workspaceId, table.storageKey],
    }),
    index('storage_cleanup_requests_due_idx').on(
      table.workspaceId,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index('storage_cleanup_requests_global_due_idx').on(
      table.nextAttemptAt,
      table.createdAt,
    ),
    check(
      'storage_cleanup_requests_reason_check',
      sql`${table.reason} IN (
        'artifact-registration-failed',
        'duplicate-upload',
        'creation-failed'
      )`,
    ),
    check(
      'storage_cleanup_requests_generation_check',
      sql`${table.generation} >= 0`,
    ),
    check(
      'storage_cleanup_requests_attempt_count_check',
      sql`${table.attemptCount} >= 0`,
    ),
  ],
)
