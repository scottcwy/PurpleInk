import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import { projects, type VersionedPayload, workspaces } from './core'

/**
 * 项目原始输入的 server-only 真值。
 *
 * 画布节点只保存工作流执行投影；脚本文本、源录音对象键与完整 URL 都从本表恢复。
 * 三列外键同时锁住项目与来源 kind，避免项目类型和来源类型在并发写入时发生漂移。
 */
export const projectSources = pgTable(
  'project_sources',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').$type<ProjectWorkflowKind>().notNull(),
    sourcePayload: jsonb('source_payload').$type<VersionedPayload>().notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'project_sources_pkey',
      columns: [table.workspaceId, table.projectId],
    }),
    foreignKey({
      name: 'project_sources_project_kind_fk',
      columns: [table.workspaceId, table.projectId, table.kind],
      foreignColumns: [
        projects.workspaceId,
        projects.id,
        projects.workflowKind,
      ],
    }).onDelete('cascade'),
    check(
      'project_sources_kind_check',
      sql`${table.kind} in ('script', 'audio', 'website')`,
    ),
    check(
      'project_sources_payload_version_check',
      sql`jsonb_typeof(${table.sourcePayload}) = 'object'
        and ${table.sourcePayload} ->> 'schemaVersion' = '1'`,
    ),
    check(
      'project_sources_fingerprint_check',
      sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)
