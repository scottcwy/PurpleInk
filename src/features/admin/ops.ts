import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import {
  providerDispatchCooldowns,
  providerDispatches,
  taskAttempts,
} from '@/lib/db/schema/index'
import { RETRY_WINDOW_MS } from '@/lib/queue/retry-policy'

/**
 * 系统运维快照（管理后台 /admin/ops 消费，客户端轮询）。
 *
 * - DB：`select 1` 往返延迟。
 * - worker：服务端 fetch `BACKEND_ORIGIN/health`（与 next.config.ts 反代同源），
 *   不经浏览器——worker 生产不对公网暴露。
 * - 队列：task_attempts 聚合深度；失败窗口与 retry-policy 的 RETRY_WINDOW_MS
 *   同口径（30 分钟）。
 * - 供应商：provider_dispatches 滚动 60 秒 RPM/TPM 占用 + 未过期 reserved 并发，
 *   与 dispatch-gate 的统计口径一致（released 行保留就是为了这里能算）。
 */

const WORKER_HEALTH_TIMEOUT_MS = 3000
const PROVIDER_ROLLING_WINDOW = sql`now() - interval '60 seconds'`

export interface OpsSnapshot {
  db: { ok: boolean; latencyMs: number | null; error?: string }
  worker: { ok: boolean; jobs: number | null; error?: string }
  queue: {
    queued: number
    running: number
    /** 30 分钟窗口内落定的 failed attempt 数（retry-policy 同口径）。 */
    failedRecent: number
  }
  providers: {
    provider: string
    funding: string
    /** 最近 60 秒内发起的请求数（滚动 RPM 占用）。 */
    rpm: number
    /** 最近 60 秒内的 token 预估合计（滚动 TPM 占用）。 */
    tpm: number
    /** lease 未过期的 reserved 行数（在途并发）。 */
    active: number
  }[]
  cooldowns: { provider: string; blockedUntil: Date }[]
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const [db, worker] = await Promise.all([probeDb(), probeWorker()])
  if (!db.ok) {
    // DB 都不可达时后面的聚合必然失败，直接给出空聚合而不是抛 500。
    return { db, worker, queue: { queued: 0, running: 0, failedRecent: 0 }, providers: [], cooldowns: [] }
  }
  const database = await getDb()
  const [queueRows, providerRows, cooldownRows] = await Promise.all([
    database
      .select({
        queued: sql<number>`count(*) filter (where ${taskAttempts.status} = 'queued')::int`,
        running: sql<number>`count(*) filter (where ${taskAttempts.status} = 'running')::int`,
        failedRecent: sql<number>`count(*) filter (
          where ${taskAttempts.status} = 'failed'
            and ${taskAttempts.completedAt} >= now() - make_interval(secs => ${RETRY_WINDOW_MS / 1000})
        )::int`,
      })
      .from(taskAttempts),
    database
      .select({
        provider: providerDispatches.provider,
        funding: providerDispatches.funding,
        rpm: sql<number>`count(*) filter (
          where ${providerDispatches.reservedAt} >= ${PROVIDER_ROLLING_WINDOW}
        )::int`,
        tpm: sql<number>`coalesce(sum(${providerDispatches.tokenEstimate}) filter (
          where ${providerDispatches.reservedAt} >= ${PROVIDER_ROLLING_WINDOW}
        ), 0)::int`,
        active: sql<number>`count(*) filter (
          where ${providerDispatches.status} = 'reserved'
            and ${providerDispatches.leaseExpiresAt} > now()
        )::int`,
      })
      .from(providerDispatches)
      // 只看仍有信号的行，避免全表扫历史：滚动窗口内 + 在途 reserved。
      .where(sql`
        ${providerDispatches.reservedAt} >= ${PROVIDER_ROLLING_WINDOW}
        or (${providerDispatches.status} = 'reserved' and ${providerDispatches.leaseExpiresAt} > now())
      `)
      .groupBy(providerDispatches.provider, providerDispatches.funding),
    database
      .select({
        provider: providerDispatchCooldowns.provider,
        blockedUntil: providerDispatchCooldowns.blockedUntil,
      })
      .from(providerDispatchCooldowns)
      .where(sql`${providerDispatchCooldowns.blockedUntil} > now()`),
  ])
  return {
    db,
    worker,
    queue: queueRows[0] ?? { queued: 0, running: 0, failedRecent: 0 },
    providers: providerRows,
    cooldowns: cooldownRows,
  }
}

async function probeDb(): Promise<OpsSnapshot['db']> {
  try {
    const database = await getDb()
    const startedAt = performance.now()
    await database.execute(sql`select 1`)
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) }
  } catch (error) {
    return { ok: false, latencyMs: null, error: errorMessage(error) }
  }
}

async function probeWorker(): Promise<OpsSnapshot['worker']> {
  const backend = process.env.BACKEND_ORIGIN || 'http://localhost:8787'
  try {
    const response = await fetch(`${backend}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(WORKER_HEALTH_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, jobs: null, error: `HTTP ${response.status}` }
    const body = (await response.json()) as { ok?: boolean; jobs?: number }
    return { ok: body.ok === true, jobs: typeof body.jobs === 'number' ? body.jobs : null }
  } catch (error) {
    return { ok: false, jobs: null, error: errorMessage(error) }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
