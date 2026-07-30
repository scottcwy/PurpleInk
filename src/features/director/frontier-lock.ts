import 'server-only'
import { sql } from 'drizzle-orm'
import type { Db } from '@/lib/db/client'

/**
 * 同一项目的即时推进与周期性修复共用一把跨进程锁。
 * 锁只保护 frontier 计算与幂等入队；实际任务执行不持锁。
 */
export function withProjectFrontierLock<T>(
  database: Db,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`director-frontier:${projectId}`}, 0)
      )
    `)
    return operation()
  })
}
