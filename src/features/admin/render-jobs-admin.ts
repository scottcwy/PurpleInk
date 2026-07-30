import 'server-only'
import { desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  RENDER_JOB_STATUSES,
  renderJobs,
  type RenderJobLogEntry,
} from '@/lib/db/schema/index'

/**
 * 渲染任务监控查询（管理后台 /admin/jobs 消费）。
 *
 * 数据源是 worker 异步落影的 render_jobs（server/src/server/job-db.ts），
 * 真值在 worker 内存 job-store——这里只读镜像，允许秒级滞后。
 */

export const RENDER_JOBS_PAGE_SIZE_MAX = 100

export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number]

export interface RenderJobListItem {
  id: string
  kind: string
  input: string
  status: string
  phase: string
  error: string | null
  elapsedSec: number | null
  durationSec: number | null
  checkPassed: boolean | null
  goldenVerified: boolean | null
  createdAt: Date
  updatedAt: Date
}

export interface RenderJobSummary {
  /** 今日（DB 自然日）创建的任务数。 */
  today: number
  /** 今日已落定任务的成功率（done / (done + failed)）；无落定任务为 null。 */
  successRate: number | null
  /** 今日 done 任务的平均视频时长秒数；无则 null。 */
  avgDurationSec: number | null
}

export interface RenderJobList {
  jobs: RenderJobListItem[]
  total: number
  page: number
  pageSize: number
  summary: RenderJobSummary
}

export async function listRenderJobs(input: {
  status?: RenderJobStatus
  page: number
  pageSize: number
}): Promise<RenderJobList> {
  const database = await getDb()
  const pageSize = Math.min(Math.max(input.pageSize, 1), RENDER_JOBS_PAGE_SIZE_MAX)
  const page = Math.max(input.page, 1)
  const where = input.status ? eq(renderJobs.status, input.status) : sql`true`

  const [jobs, counted, summaryRows] = await Promise.all([
    database
      .select({
        id: renderJobs.id,
        kind: renderJobs.kind,
        input: renderJobs.input,
        status: renderJobs.status,
        phase: renderJobs.phase,
        error: renderJobs.error,
        elapsedSec: renderJobs.elapsedSec,
        durationSec: renderJobs.durationSec,
        checkPassed: renderJobs.checkPassed,
        goldenVerified: renderJobs.goldenVerified,
        createdAt: renderJobs.createdAt,
        updatedAt: renderJobs.updatedAt,
      })
      .from(renderJobs)
      .where(where)
      .orderBy(desc(renderJobs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    database
      .select({ total: sql<number>`count(*)::int` })
      .from(renderJobs)
      .where(where),
    database
      .select({
        today: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${renderJobs.status} = 'done')::int`,
        failed: sql<number>`count(*) filter (where ${renderJobs.status} = 'failed')::int`,
        avgDurationSec: sql<number | null>`avg(${renderJobs.durationSec}) filter (
          where ${renderJobs.status} = 'done'
        )`,
      })
      .from(renderJobs)
      .where(sql`${renderJobs.createdAt} >= date_trunc('day', now())`),
  ])

  const stats = summaryRows[0]
  const settled = (stats?.done ?? 0) + (stats?.failed ?? 0)
  return {
    jobs,
    total: counted[0]?.total ?? 0,
    page,
    pageSize,
    summary: {
      today: stats?.today ?? 0,
      successRate: settled > 0 ? (stats?.done ?? 0) / settled : null,
      avgDurationSec:
        stats?.avgDurationSec === null || stats?.avgDurationSec === undefined
          ? null
          : Number(stats.avgDurationSec),
    },
  }
}

export interface RenderJobDetail extends RenderJobListItem {
  logs: RenderJobLogEntry[]
}

export async function getRenderJob(id: string): Promise<RenderJobDetail | null> {
  const database = await getDb()
  const [row] = await database
    .select()
    .from(renderJobs)
    .where(eq(renderJobs.id, id))
    .limit(1)
  return row ?? null
}
