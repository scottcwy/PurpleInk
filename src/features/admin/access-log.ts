import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiAccessCounters } from '@/lib/db/schema/index'

/**
 * 接口访问计数埋点（安全监控数据源）。
 *
 * 挂在 `withApiSession` 出口，按响应 status 归类后 fire-and-forget 累加到
 * `api_access_counters` 的当前分钟窗口。刻意吞掉一切错误：打点失败绝不能影响
 * 业务响应。写入是单条原子 upsert，成本与 auth_throttle 同级。
 */

export type ApiAccessOutcome = '2xx' | '4xx' | '401' | '404' | '5xx'

/** HTTP 状态码归类：401/404 单列（撞库、探表面的信号），其余按类段合并。 */
export function classifyOutcome(status: number): ApiAccessOutcome {
  if (status === 401) return '401'
  if (status === 404) return '404'
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  return '2xx'
}

/**
 * 累加一次访问计数。`routeGroup` 必须是稳定分组名（不含 id / query），
 * 否则会撑爆基数——调用方负责归一化。失败仅吞掉，不抛不阻塞。
 */
export async function recordApiAccess(
  routeGroup: string,
  status: number,
): Promise<void> {
  try {
    const database = await getDb()
    await database
      .insert(apiAccessCounters)
      .values({
        bucketStartedAt: sql`date_trunc('minute', now())`,
        routeGroup,
        outcome: classifyOutcome(status),
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          apiAccessCounters.bucketStartedAt,
          apiAccessCounters.routeGroup,
          apiAccessCounters.outcome,
        ],
        set: { count: sql`${apiAccessCounters.count} + 1` },
      })
  } catch {
    // 打点是尽力而为：任何失败都不得影响业务响应。
  }
}
