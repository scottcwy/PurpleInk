import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { projects, type VersionedPayload, workspaces } from './core'

export const CANVAS_NODE_TYPES = [
  'script-import',
  'shot-split',
  'score',
  'export',
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
] as const

export const CANVAS_NODE_STAGES = [
  'INGEST',
  'DIRECT',
  'SHOT_SPEC',
  'FABRICATE',
  'ASSEMBLE',
  'FINALIZE',
] as const

export const NODE_STATUSES = [
  'idle',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'stale',
] as const

export const canvasNodes = pgTable(
  'canvas_nodes',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    projectId: uuid('project_id').notNull(),
    logicalKey: text('logical_key').notNull(),
    type: text('type').notNull(),
    stage: text('stage').notNull(),
    status: text('status').default('idle').notNull(),
    positionX: doublePrecision('position_x').notNull(),
    positionY: doublePrecision('position_y').notNull(),
    data: jsonb('data').$type<VersionedPayload>().notNull(),
    revision: bigint('revision', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'canvas_nodes_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'canvas_nodes_project_fk',
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete('cascade'),
    unique('canvas_nodes_logical_key_unique').on(
      table.workspaceId,
      table.projectId,
      table.logicalKey,
    ),
    unique('canvas_nodes_workspace_project_id_unique').on(
      table.workspaceId,
      table.projectId,
      table.id,
    ),
    check(
      'canvas_nodes_type_check',
      sql`${table.type} in (
        'script-import', 'shot-split', 'score', 'export', 'shot-script',
        'shot-codegen', 'shot-sfx', 'shot-subtitle', 'shot-qa'
      )`,
    ),
    check(
      'canvas_nodes_stage_check',
      sql`${table.stage} in (
        'INGEST', 'DIRECT', 'SHOT_SPEC', 'FABRICATE', 'ASSEMBLE', 'FINALIZE'
      )`,
    ),
    check(
      'canvas_nodes_status_check',
      sql`${table.status} in (
        'idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale'
      )`,
    ),
    check('canvas_nodes_revision_check', sql`${table.revision} >= 0`),
  ],
)

export const canvasEdges = pgTable(
  'canvas_edges',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    id: uuid('id').defaultRandom().notNull(),
    projectId: uuid('project_id').notNull(),
    source: uuid('source').notNull(),
    target: uuid('target').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'canvas_edges_pkey',
      columns: [table.workspaceId, table.id],
    }),
    foreignKey({
      name: 'canvas_edges_project_fk',
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projects.workspaceId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'canvas_edges_source_fk',
      columns: [table.workspaceId, table.projectId, table.source],
      foreignColumns: [
        canvasNodes.workspaceId,
        canvasNodes.projectId,
        canvasNodes.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'canvas_edges_target_fk',
      columns: [table.workspaceId, table.projectId, table.target],
      foreignColumns: [
        canvasNodes.workspaceId,
        canvasNodes.projectId,
        canvasNodes.id,
      ],
    }).onDelete('cascade'),
    unique('canvas_edges_endpoints_unique').on(
      table.workspaceId,
      table.projectId,
      table.source,
      table.target,
    ),
  ],
)
