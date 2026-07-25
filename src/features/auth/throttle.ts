import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { authThrottle } from '@/lib/db/schema/index'

/**
 * 固定窗口速率限制（PLAN-002 §3.5）。
 *
 * 阈值写成常量、可被测试覆盖，不散落魔法数字。固定窗口不如令牌桶精确，
 * 但这里要挡的是脚本刷量，边界处多放几次无实质影响。
 *
 * 多实例部署下每实例各算一份窗口，会整体变宽松——已知取舍，见 ISSUE-015 P-9。
 */
export interface ThrottleRule {
  limit: number
  windowMs: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const THROTTLE_RULES = {
  /** 同 IP 签发验证码：10 / 小时 */
  codeByIp: { limit: 10, windowMs: HOUR },
  /** 同邮箱签发验证码：3 / 10 分钟 */
  codeByEmailShort: { limit: 3, windowMs: 10 * MINUTE },
  /** 同邮箱签发验证码：5 / 天 */
  codeByEmailDaily: { limit: 5, windowMs: DAY },
  /** 同邮箱登录失败：10 / 15 分钟 */
  loginFailureByEmail: { limit: 10, windowMs: 15 * MINUTE },
  /** 同 IP 登录失败：30 / 15 分钟（挡撞库） */
  loginFailureByIp: { limit: 30, windowMs: 15 * MINUTE },
} as const satisfies Record<string, ThrottleRule>

export type ThrottleRuleName = keyof typeof THROTTLE_RULES

/** 清理窗口用的最长跨度，`pruneExpiredAuthRows` 据此决定删哪些行。 */
export const LONGEST_THROTTLE_WINDOW_MS = DAY

export interface ThrottleDecision {
  allowed: boolean
  retryAfterMs: number
}

/**
 * IP 与邮箱都只以哈希入 key，原值不落库（避免 PII）。
 * 哈希不加盐是有意的：需要跨请求可比对；这里的目的不是防反查，而是不存明文。
 */
function throttleKey(rule: ThrottleRuleName, dimension: string, value: string): string {
  const digest = createHash('sha256').update(value.trim().toLowerCase(), 'utf8').digest('hex')
  return `${dimension}:${digest.slice(0, 32)}:${rule}`
}

/**
 * 消费一个配额位。原子性靠单条 upsert 完成：
 * 窗口已过期则重置为 1，否则 +1，然后判断是否越界。
 *
 * 返回越界时给出 `retryAfterMs`，由调用方映射成 429 + `Retry-After`。
 */
export async function consumeThrottleSlot(input: {
  rule: ThrottleRuleName
  dimension: 'ip' | 'email'
  value: string
  now: Date
}): Promise<ThrottleDecision> {
  const { limit, windowMs } = THROTTLE_RULES[input.rule]
  const key = throttleKey(input.rule, input.dimension, input.value)
  const windowStart = new Date(input.now.getTime() - windowMs)
  const database = await getDb()
  const [row] = await database
    .insert(authThrottle)
    .values({ key, windowStartedAt: input.now, count: 1 })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        windowStartedAt: sql`case when ${authThrottle.windowStartedAt} <= ${windowStart}
          then ${input.now} else ${authThrottle.windowStartedAt} end`,
        count: sql`case when ${authThrottle.windowStartedAt} <= ${windowStart}
          then 1 else ${authThrottle.count} + 1 end`,
      },
    })
    .returning({ count: authThrottle.count, windowStartedAt: authThrottle.windowStartedAt })
  if (!row) return { allowed: true, retryAfterMs: 0 }
  if (row.count <= limit) return { allowed: true, retryAfterMs: 0 }
  const elapsed = input.now.getTime() - row.windowStartedAt.getTime()
  return { allowed: false, retryAfterMs: Math.max(1_000, windowMs - elapsed) }
}

/** 登录成功后清掉该维度的失败计数，避免正常用户被自己的历史失败拖住。 */
export async function clearThrottleSlot(input: {
  rule: ThrottleRuleName
  dimension: 'ip' | 'email'
  value: string
}): Promise<void> {
  const database = await getDb()
  await database
    .delete(authThrottle)
    .where(eq(authThrottle.key, throttleKey(input.rule, input.dimension, input.value)))
}

/** 只读当前计数，供「登录失败过多则强制人机验证」这类判断使用。 */
export async function readThrottleCount(input: {
  rule: ThrottleRuleName
  dimension: 'ip' | 'email'
  value: string
  now: Date
}): Promise<number> {
  const { windowMs } = THROTTLE_RULES[input.rule]
  const database = await getDb()
  const [row] = await database
    .select({ count: authThrottle.count })
    .from(authThrottle)
    .where(
      and(
        eq(authThrottle.key, throttleKey(input.rule, input.dimension, input.value)),
        sql`${authThrottle.windowStartedAt} > ${new Date(input.now.getTime() - windowMs)}`,
      ),
    )
    .limit(1)
  return row?.count ?? 0
}
