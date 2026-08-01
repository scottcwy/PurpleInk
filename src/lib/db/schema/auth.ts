import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { workspaces } from './core'

export const USER_STATUSES = ['active', 'disabled'] as const
export const USER_ROLES = ['user', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]
export const API_ACCESS_OUTCOMES = ['2xx', '4xx', '5xx', '401', '404'] as const
export type ApiAccessOutcome = (typeof API_ACCESS_OUTCOMES)[number]
export const WORKSPACE_MEMBER_ROLES = ['owner', 'member'] as const
export const VERIFICATION_PURPOSES = ['signup', 'password_reset'] as const

/**
 * 应用内身份。
 *
 * 归属关系不落在本表：`users` 不带 `workspaceId` 列，"这个人能看哪个 workspace"
 * 唯一由 `workspace_members` 表达（PLAN-002 §2.2）。否则将来做协作时
 * 会出现两套真值。
 *
 * `passwordHash` 是不可逆哈希（`src/features/auth/password.ts` 的 scrypt 串），
 * 与 `provider_credentials` 的可解密信封是两件事，密钥绝不共用（AGENTS.md §7）。
 * `passwordUpdatedAt` 用于改密后失效旧会话。
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    role: text('role').default('user').notNull(),
    status: text('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // 唯一性建在 lower(email) 上：A@x.com 与 a@x.com 是同一个人，不允许重复注册。
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    check('users_role_check', sql`${table.role} in ('user', 'admin')`),
    check('users_status_check', sql`${table.status} in ('active', 'disabled')`),
    check('users_email_shape_check', sql`position('@' in ${table.email}) > 1`),
  ],
)

/**
 * 用户与 workspace 的归属关系（PLAN-002 §1.1 方案 B）。
 * 首版每个注册用户恰好一条 `owner`；`member` 角色为将来协作预留，
 * 首版不签发、不消费。
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').default('owner').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'workspace_members_pkey',
      columns: [table.workspaceId, table.userId],
    }),
    index('workspace_members_user_idx').on(table.userId),
    check(
      'workspace_members_role_check',
      sql`${table.role} in ('owner', 'member')`,
    ),
  ],
)

/**
 * 服务端持久会话。
 *
 * 有意不用无状态 JWT：登出即失效、改密码踢下线必须真实生效，且 DB 会话天然跨实例
 * 可见（ISSUE-015 P-9 的前置条件之一）。cookie 里只有高熵随机明文，
 * 本表只存其 SHA-256。`workspaceId` 在登录时解析并固化，避免每请求再 join。
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userAgentHash: text('user_agent_hash'),
    ipHash: text('ip_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
    check(
      'sessions_token_hash_shape_check',
      sql`length(${table.tokenHash}) = 64`,
    ),
  ],
)

/**
 * 邮件验证码。注册时用户行还不存在，因此按 email 而不是 userId 定位。
 * 只存哈希、限尝试次数、10 分钟过期、一次性消费（PLAN-002 §1.4）。
 */
export const emailVerificationCodes = pgTable(
  'email_verification_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('email_verification_codes_lookup_idx').on(
      table.email,
      table.purpose,
      table.expiresAt,
    ),
    check(
      'email_verification_codes_purpose_check',
      sql`${table.purpose} in ('signup', 'password_reset')`,
    ),
    check(
      'email_verification_codes_attempt_check',
      sql`${table.attemptCount} >= 0`,
    ),
  ],
)

/**
 * 固定窗口速率限制计数器（PLAN-002 §3.5）。
 * `key` 形如 `ip:<sha256>:signup`、`email:<sha256>:login`——只存哈希，不落 PII。
 * 多实例部署下每实例各算一份窗口，会变宽松，见 ISSUE-015 P-9。
 */
export const authThrottle = pgTable(
  'auth_throttle',
  {
    key: text('key').primaryKey(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    count: integer('count').default(0).notNull(),
  },
  (table) => [check('auth_throttle_count_check', sql`${table.count} >= 0`)],
)

/**
 * API 访问量的分钟桶。只记录调用方在代码中声明的 route group，不记录 URL、query、
 * email、workspace 或 IP；outcome 只存安全 status 类别。写入是 fire-and-forget
 * 旁路，失败不得改变业务响应。
 */
export const apiAccessCounters = pgTable(
  'api_access_counters',
  {
    routeGroup: text('route_group').notNull(),
    outcome: text('outcome').notNull(),
    bucketStartedAt: timestamp('bucket_started_at', { withTimezone: true }).notNull(),
    count: integer('count').default(1).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'api_access_counters_pkey',
      columns: [table.bucketStartedAt, table.routeGroup, table.outcome],
    }),
    check('api_access_counters_route_group_check', sql`length(${table.routeGroup}) between 1 and 80`),
    check('api_access_counters_outcome_check', sql`${table.outcome} in ('2xx', '4xx', '5xx', '401', '404')`),
    check('api_access_counters_count_check', sql`${table.count} >= 0`),
  ],
)
