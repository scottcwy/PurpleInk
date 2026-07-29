import { sql } from 'drizzle-orm'
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/** 全局遥测切换点；统计完整度必须来自持久化事实，不能由进程启动时间猜测。 */
export const telemetryCutovers = pgTable(
  'telemetry_cutovers',
  {
    key: text('key').primaryKey(),
    cutoverAt: timestamp('cutover_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'telemetry_cutovers_key_check',
      sql`${table.key} in ('ai_invocation_v2')`,
    ),
  ],
)
