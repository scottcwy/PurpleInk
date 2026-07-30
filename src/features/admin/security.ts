import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { apiAccessCounters, authThrottle } from '@/lib/db/schema/index'
import { THROTTLE_RULES, type ThrottleRuleName } from '@/features/auth/throttle'

/**
 * 安全监控快照（管理后台 /admin/security 消费，客户端轮询）。
 *
 * 两块只读聚合，均不落 PII：
 * - 接口访问：`api_access_counters` 近 24h 各 routeGroup 的量与错误占比（异常放量、
 *   401/404 探测的信号）。
 * - 限流/攻击：`auth_throttle` 当前活跃计数按规则聚合，标出接近/超过 `THROTTLE_RULES`
 *   阈值的规则（撞库、刷验证码的信号）。auth_throttle 只存哈希，窗口按规则各异，
 *   因此活跃判定在 JS 侧用规则常量算，不硬编到 SQL。
 */

const ACCESS_WINDOW_HOURS = 24
const ROUTE_LIMIT = 60

/** 规则的中文说明，仅用于展示；键与 THROTTLE_RULES 一一对应。 */
const RULE_LABELS: Record<ThrottleRuleName, string> = {
  codeByIp: '同 IP 验证码签发',
  codeByEmailShort: '同邮箱验证码（10 分钟）',
  codeByEmailDaily: '同邮箱验证码（当日）',
  loginFailureByEmail: '同邮箱登录失败',
  loginFailureByIp: '同 IP 登录失败（撞库）',
}

export interface RouteAccessStat {
  routeGroup: string
  total: number
  ok: number
  clientError: number
  unauthorized: number
  notFound: number
  serverError: number
  /** (4xx + 401 + 404 + 5xx) / total，0..1。 */
  errorRate: number
}

export interface ThrottleSignal {
  rule: ThrottleRuleName
  label: string
  limit: number
  windowMs: number
  /** 当前仍在窗口内的去重 key 数（活跃维度数）。 */
  activeKeys: number
  /** 其中计数已达/超过阈值的 key 数（已被限流挡下的维度）。 */
  atOrOverLimit: number
  /** 活跃 key 中的最高单键计数。 */
  maxCount: number
}

export interface SecuritySnapshot {
  windowHours: number
  totalRequests: number
  routes: RouteAccessStat[]
  throttle: ThrottleSignal[]
}

interface ThrottleRow {
  key: string
  count: number
  windowStartedAt: Date
}

export async function getSecuritySnapshot(): Promise<SecuritySnapshot> {
  const database = await getDb()
  const [routeRows, throttleRows] = await Promise.all([
    database
      .select({
        routeGroup: apiAccessCounters.routeGroup,
        total: sql<number>`sum(${apiAccessCounters.count})::int`,
        ok: sql<number>`coalesce(sum(${apiAccessCounters.count}) filter (where ${apiAccessCounters.outcome} = '2xx'), 0)::int`,
        clientError: sql<number>`coalesce(sum(${apiAccessCounters.count}) filter (where ${apiAccessCounters.outcome} = '4xx'), 0)::int`,
        unauthorized: sql<number>`coalesce(sum(${apiAccessCounters.count}) filter (where ${apiAccessCounters.outcome} = '401'), 0)::int`,
        notFound: sql<number>`coalesce(sum(${apiAccessCounters.count}) filter (where ${apiAccessCounters.outcome} = '404'), 0)::int`,
        serverError: sql<number>`coalesce(sum(${apiAccessCounters.count}) filter (where ${apiAccessCounters.outcome} = '5xx'), 0)::int`,
      })
      .from(apiAccessCounters)
      .where(sql`${apiAccessCounters.bucketStartedAt} >= now() - make_interval(hours => ${ACCESS_WINDOW_HOURS})`)
      .groupBy(apiAccessCounters.routeGroup)
      .orderBy(sql`sum(${apiAccessCounters.count}) desc`)
      .limit(ROUTE_LIMIT),
    // auth_throttle 已按 pruneExpiredAuthRows 控制在最长窗口内，全量取回在 JS 聚合。
    database
      .select({
        key: authThrottle.key,
        count: authThrottle.count,
        windowStartedAt: authThrottle.windowStartedAt,
      })
      .from(authThrottle),
  ])

  const routes: RouteAccessStat[] = routeRows.map((row) => {
    const errors = row.clientError + row.unauthorized + row.notFound + row.serverError
    return {
      routeGroup: row.routeGroup,
      total: row.total,
      ok: row.ok,
      clientError: row.clientError,
      unauthorized: row.unauthorized,
      notFound: row.notFound,
      serverError: row.serverError,
      errorRate: row.total > 0 ? errors / row.total : 0,
    }
  })

  return {
    windowHours: ACCESS_WINDOW_HOURS,
    totalRequests: routes.reduce((sum, row) => sum + row.total, 0),
    routes,
    throttle: aggregateThrottle(throttleRows),
  }
}

/** 把 auth_throttle 行按规则归并，只计仍在各自窗口内的活跃 key。 */
export function aggregateThrottle(rows: ThrottleRow[]): ThrottleSignal[] {
  const now = Date.now()
  const ruleNames = Object.keys(THROTTLE_RULES) as ThrottleRuleName[]
  const buckets = new Map<ThrottleRuleName, { active: number; over: number; max: number }>()
  for (const name of ruleNames) buckets.set(name, { active: 0, over: 0, max: 0 })

  for (const row of rows) {
    // key 形如 `ip:<hash>:codeByIp`，恰两个冒号，规则名在第三段。
    const rule = row.key.split(':')[2] as ThrottleRuleName | undefined
    if (!rule || !(rule in THROTTLE_RULES)) continue
    const { limit, windowMs } = THROTTLE_RULES[rule]
    if (now - row.windowStartedAt.getTime() >= windowMs) continue
    const bucket = buckets.get(rule)!
    bucket.active += 1
    if (row.count >= limit) bucket.over += 1
    if (row.count > bucket.max) bucket.max = row.count
  }

  return ruleNames.map((rule) => {
    const bucket = buckets.get(rule)!
    return {
      rule,
      label: RULE_LABELS[rule],
      limit: THROTTLE_RULES[rule].limit,
      windowMs: THROTTLE_RULES[rule].windowMs,
      activeKeys: bucket.active,
      atOrOverLimit: bucket.over,
      maxCount: bucket.max,
    }
  })
}
