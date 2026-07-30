import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { projects, workspaces } from './core'

export const WORKFLOW_CONCURRENCY_STATUSES = [
  'waiting',
  'active',
  'released',
  'cancelled',
  'expired',
] as const

/**
 * 工作区级分镜并发真值。一个 laneKey 在同一项目只有一行；重新生成时复用该行，
 * 因而同一分镜内部的文本、视觉、音频步骤不会重复占用套餐名额。
 */
export const workflowConcurrencyLeases = pgTable(
  'workflow_concurrency_leases',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    workUnitKey: text('work_unit_key').notNull(),
    projectId: uuid('project_id').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    planKey: text('plan_key').notNull(),
    status: text('status').default('waiting').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    notBefore: timestamp('not_before', { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'workflow_concurrency_leases_pkey',
      columns: [table.workspaceId, table.projectId, table.workUnitKey],
    }),
    foreignKey({
      name: 'workflow_concurrency_leases_project_fk',
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete('cascade'),
    index('workflow_concurrency_leases_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.requestedAt,
    ),
    check(
      'workflow_concurrency_leases_status_check',
      sql`${table.status} in ('waiting', 'active', 'released', 'cancelled', 'expired')`,
    ),
    check(
      'workflow_concurrency_leases_plan_check',
      sql`${table.planKey} in ('free', 'plus', 'pro', 'max')`,
    ),
  ],
)
