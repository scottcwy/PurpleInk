import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { canvasNodes } from './canvas'
import { projects, workspaces } from './core'

/**
 * HTTP 创建意图的持久化回执。只保存规范化请求哈希，不保存原始 URL 或请求正文。
 */
export const projectCreationRequests = pgTable(
  'project_creation_requests',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    projectId: uuid('project_id').notNull(),
    entryNodeId: uuid('entry_node_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'project_creation_requests_pkey',
      columns: [table.workspaceId, table.idempotencyKey],
    }),
    foreignKey({
      name: 'project_creation_requests_project_fk',
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_creation_requests_entry_node_fk',
      columns: [table.workspaceId, table.projectId, table.entryNodeId],
      foreignColumns: [
        canvasNodes.workspaceId,
        canvasNodes.projectId,
        canvasNodes.id,
      ],
    }).onDelete('cascade'),
    check(
      'project_creation_requests_fingerprint_check',
      sql`length(${table.requestFingerprint}) = 64`,
    ),
  ],
)
