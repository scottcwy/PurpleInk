import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

export const PROJECT_STATUSES = ['active', 'archived'] as const

export interface VersionedPayload {
  schemaVersion: number
  [key: string]: unknown
}

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('workspaces_slug_unique').on(table.slug),
  ],
)

export const projects = pgTable(
  'projects',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    title: text('title').notNull(),
    script: text('script').notNull(),
    status: text('status').default('active').notNull(),
    workflowVersion: text('workflow_version').notNull(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    exportSettings: jsonb('export_settings').$type<VersionedPayload>().notNull(),
    autopilot: boolean('autopilot').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'projects_pkey',
      columns: [table.workspaceId, table.id],
    }),
    check(
      'projects_status_check',
      sql`${table.status} in ('active', 'archived')`,
    ),
    check('projects_revision_check', sql`${table.revision} >= 0`),
  ],
)
