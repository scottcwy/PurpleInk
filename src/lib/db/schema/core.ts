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
import {
  PROJECT_WORKFLOW_KINDS,
  type ProjectWorkflowKind,
} from '@/lib/workflow/project-workflow-registry'

export const PROJECT_STATUSES = ['active', 'archived'] as const
export { PROJECT_WORKFLOW_KINDS }

export interface VersionedPayload {
  schemaVersion: number
  [key: string]: unknown
}

/**
 * Workspace 级运行时偏好的单一持久化载体。PK 由 (workspaceId, key) 唯一定位，
 * `value` 是带 schemaVersion 的 jsonb，承载该 key 的结构化值。
 * 队列并发配额（ISSUE-011）以 key = 'queue.laneQuotas' 入住此表，
 * 与 `model_routes` / `provider_credentials` 等领域表分离——并发是进程级账号偏好,
 * 不属于 AI 路由域。`key` 命名空间约束为小写 snake/点号, 由 CHECK 兜底。
 */
export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').$type<VersionedPayload>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'workspace_settings_pkey',
      columns: [table.workspaceId, table.key],
    }),
    check(
      'workspace_settings_key_shape_check',
      sql`${table.key} ~ '^[a-z][a-z0-9._-]{0,63}$'`,
    ),
  ],
)

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
    workflowKind: text('workflow_kind')
      .$type<ProjectWorkflowKind>()
      .default('script')
      .notNull(),
    workflowVersion: text('workflow_version').notNull(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    executionEpoch: bigint('execution_epoch', { mode: 'number' }).default(0).notNull(),
    exportSettings: jsonb('export_settings').$type<VersionedPayload>().notNull(),
    autopilot: boolean('autopilot').default(false).notNull(),
    directorContinuationEnabled: boolean('director_continuation_enabled')
      .default(false)
      .notNull(),
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
    check(
      'projects_workflow_kind_check',
      sql`${table.workflowKind} in ('script', 'audio', 'website')`,
    ),
    check('projects_revision_check', sql`${table.revision} >= 0`),
    check('projects_execution_epoch_check', sql`${table.executionEpoch} >= 0`),
    unique('projects_workspace_id_id_workflow_kind_unique').on(
      table.workspaceId,
      table.id,
      table.workflowKind,
    ),
  ],
)
