// render_jobs 落库：worker 内存 job-store 的异步持久化镜像（管理后台监控消费）。
//
// 设计约束：
//   - 真值仍是内存 job-store，本模块只做落影；任何 DB 失败都不得影响渲染管线。
//   - 缺 DATABASE_URL 时全程 no-op（本地无库照常跑），只在首次调用 warn 一次。
//   - 用原生 SQL，不跨包引 Next 侧的 Drizzle schema；表结构见
//     src/lib/db/schema/render-jobs.ts 与其迁移。
//   - 不落 videoPath / captureDir / projectDir 等本机绝对路径。
import postgres, { type Sql } from "postgres"
import { logger } from "../lib/logger"
import type { Job } from "./job-store"

let client: Sql | null = null
let disabled = false
let warnedDisabled = false
let warnedFailure = false

function getClient(): Sql | null {
  if (disabled) return null
  if (client) return client
  const url = process.env.DATABASE_URL
  if (!url) {
    disabled = true
    if (!warnedDisabled) {
      warnedDisabled = true
      logger.warn("jobdb:disabled", { reason: "DATABASE_URL 未设置，render_jobs 不落库" })
    }
    return null
  }
  // worker 只做低频 upsert，2 个连接足够；连不上时由每次调用各自捕获。
  client = postgres(url, { max: 2 })
  return client
}

/** upsert 单个 Job；失败只 warn（首个失败记一次，避免刷屏），绝不抛出。 */
export function persistJob(job: Job): void {
  const sql = getClient()
  if (!sql) return
  void sql`
    insert into render_jobs (
      id, kind, input, status, phase, error,
      elapsed_sec, duration_sec, check_passed, golden_verified,
      logs, created_at, updated_at
    ) values (
      ${job.id}, ${job.kind}, ${job.input}, ${job.status}, ${job.phase}, ${job.error ?? null},
      ${job.elapsedSec ?? null}, ${job.durationSec ?? null},
      ${job.checkPassed ?? null}, ${job.goldenVerified ?? null},
      ${sql.json(job.logs)}, ${new Date(job.createdAt)}, ${new Date(job.updatedAt)}
    )
    on conflict (id) do update set
      status = excluded.status,
      phase = excluded.phase,
      error = excluded.error,
      elapsed_sec = excluded.elapsed_sec,
      duration_sec = excluded.duration_sec,
      check_passed = excluded.check_passed,
      golden_verified = excluded.golden_verified,
      logs = excluded.logs,
      updated_at = excluded.updated_at
  `.catch((err: unknown) => {
    if (warnedFailure) return
    warnedFailure = true
    logger.warn("jobdb:persist_failed", { id: job.id, error: String(err) })
  })
}

/**
 * 启动对账：worker job 是内存态，进程重启后库里的 queued/running 都是孤儿，
 * 统一标记 failed，避免管理后台出现永远"运行中"的僵尸任务。
 */
export async function reconcileOrphanJobs(): Promise<void> {
  const sql = getClient()
  if (!sql) return
  try {
    const rows = await sql`
      update render_jobs
      set status = 'failed', phase = 'failed',
          error = 'worker restarted', updated_at = now()
      where status in ('queued', 'running')
      returning id
    `
    if (rows.length > 0) logger.info("jobdb:orphans_reconciled", { count: rows.length })
  } catch (err) {
    logger.warn("jobdb:reconcile_failed", { error: String(err) })
  }
}
