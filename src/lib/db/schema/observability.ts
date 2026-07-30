import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/** 计数命中的响应归类；与 recordApiAccess 的 classifyOutcome 一一对应。 */
export const API_ACCESS_OUTCOMES = ['2xx', '4xx', '401', '404', '5xx'] as const

/**
 * 接口访问计数（管理后台安全监控消费）。
 *
 * 固定 1 分钟窗口聚合，与 `auth_throttle` 同款取舍：写入是单条原子 upsert
 * （count+1），成本与限流计数器一个量级；多副本部署下每副本各算一份、整体偏宽松，
 * 够看趋势与异常放量，不作计费依据（计划 Assumptions）。
 *
 * `routeGroup` 是调用方给出的稳定分组名（如 `POST /api/projects`），不落原始
 * 带 id 的路径，避免基数爆炸。不落任何 PII / query。
 */
export const apiAccessCounters = pgTable(
  'api_access_counters',
  {
    /** 该分钟窗口的起点（date_trunc('minute') 对齐）。 */
    bucketStartedAt: timestamp('bucket_started_at', { withTimezone: true }).notNull(),
    routeGroup: text('route_group').notNull(),
    outcome: text('outcome').notNull(),
    count: integer('count').default(0).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'api_access_counters_pkey',
      columns: [table.bucketStartedAt, table.routeGroup, table.outcome],
    }),
    index('api_access_counters_bucket_idx').on(table.bucketStartedAt.desc()),
    check(
      'api_access_counters_outcome_check',
      sql`${table.outcome} in ('2xx', '4xx', '401', '404', '5xx')`,
    ),
    check('api_access_counters_count_check', sql`${table.count} >= 0`),
  ],
)
