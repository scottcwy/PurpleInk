import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const RENDER_JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export const RENDER_JOB_KINDS = ['url', 'capture'] as const

/** 与 worker job-store 的阶段枚举对齐（server/src/server/job-store.ts）。 */
export const RENDER_JOB_PHASES = [
  'queued',
  'capturing',
  'scripting',
  'synthesizing',
  'timing',
  'composing',
  'rendering',
  'verifying',
  'muxing',
  'done',
  'failed',
] as const

export interface RenderJobLogEntry {
  at: number
  msg: string
}

/**
 * worker 渲染任务的持久化镜像（管理后台监控消费）。
 *
 * 写入方是 worker（server/src/lib/job-db.ts，原生 SQL upsert），真值仍是
 * worker 内存 job-store——本表只做异步落影，写失败不阻塞渲染管线。
 * id 由 worker 侧 randomUUID() 生成，因此不设 defaultRandom。
 * 不落 videoPath / captureDir 等本机绝对路径（对外表面同 toPublicJob 口径）。
 */
export const renderJobs = pgTable(
  'render_jobs',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    input: text('input').notNull(),
    status: text('status').default('queued').notNull(),
    phase: text('phase').default('queued').notNull(),
    error: text('error'),
    elapsedSec: real('elapsed_sec'),
    durationSec: real('duration_sec'),
    checkPassed: boolean('check_passed'),
    goldenVerified: boolean('golden_verified'),
    /** [{ at: epochMs, msg }]，原样存 worker 的阶段日志，供 admin 展示时间线。 */
    logs: jsonb('logs').$type<RenderJobLogEntry[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('render_jobs_created_idx').on(table.createdAt.desc()),
    index('render_jobs_status_idx').on(table.status),
    check(
      'render_jobs_status_check',
      sql`${table.status} in ('queued', 'running', 'done', 'failed')`,
    ),
    check('render_jobs_kind_check', sql`${table.kind} in ('url', 'capture')`),
  ],
)
