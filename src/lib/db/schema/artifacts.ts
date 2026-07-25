import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { projects, workspaces } from './core'
import { taskAttempts } from './execution'

export const ARTIFACT_LIFECYCLES = [
  'draft',
  'approved',
  'released',
  'rejected',
] as const

export const artifacts = pgTable(
  'artifacts',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    projectId: uuid('project_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    lifecycle: text('lifecycle').default('draft').notNull(),
    schemaVersion: text('schema_version').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    contentHash: text('content_hash').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    supersedesArtifactId: uuid('supersedes_artifact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'artifacts_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'artifacts_project_fk',
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'artifacts_attempt_fk',
      columns: [table.workspaceId, table.attemptId],
      foreignColumns: [taskAttempts.workspaceId, taskAttempts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'artifacts_supersedes_fk',
      columns: [
        table.workspaceId,
        table.projectId,
        table.supersedesArtifactId,
      ],
      foreignColumns: [
        table.workspaceId,
        table.projectId,
        table.id,
      ],
    }).onDelete('restrict'),
    unique('artifacts_version_unique').on(
      table.workspaceId,
      table.aggregateType,
      table.aggregateId,
      table.kind,
      table.version,
    ),
    unique('artifacts_workspace_project_id_unique').on(
      table.workspaceId,
      table.projectId,
      table.id,
    ),
    check(
      'artifacts_lifecycle_check',
      sql`${table.lifecycle} in ('draft', 'approved', 'released', 'rejected')`,
    ),
    check('artifacts_version_check', sql`${table.version} > 0`),
    check('artifacts_size_bytes_check', sql`${table.sizeBytes} >= 0`),
    check(
      'artifacts_content_hash_check',
      sql`length(${table.contentHash}) = 64`,
    ),
  ],
)
