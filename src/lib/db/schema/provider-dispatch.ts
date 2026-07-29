import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { workspaces } from './core'

export const PROVIDER_DISPATCH_STATUSES = ['reserved', 'released'] as const

/**
 * Provider 出网预留事实。released 行继续保留用于滚动 RPM/TPM 统计；并发只统计
 * lease 尚未过期的 reserved 行。scopeKey 已包含 funding 与凭据指纹，不存 Key。
 */
export const providerDispatches = pgTable(
  'provider_dispatches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scopeKey: text('scope_key').notNull(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    attemptId: uuid('attempt_id'),
    provider: text('provider').notNull(),
    funding: text('funding').notNull(),
    status: text('status').default('reserved').notNull(),
    tokenEstimate: integer('token_estimate').default(0).notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    index('provider_dispatches_scope_reserved_idx').on(
      table.scopeKey,
      table.reservedAt,
    ),
    index('provider_dispatches_scope_lease_idx').on(
      table.scopeKey,
      table.status,
      table.leaseExpiresAt,
    ),
    check('provider_dispatches_scope_key_check', sql`length(${table.scopeKey}) = 64`),
    check(
      'provider_dispatches_funding_check',
      sql`${table.funding} in ('managed', 'byok')`,
    ),
    check(
      'provider_dispatches_status_check',
      sql`${table.status} in ('reserved', 'released')`,
    ),
    check('provider_dispatches_token_estimate_check', sql`${table.tokenEstimate} >= 0`),
  ],
)

/** Provider 真实 429 学到的共享冷却窗口；同 scope 的所有进程在此时间前均不出网。 */
export const providerDispatchCooldowns = pgTable(
  'provider_dispatch_cooldowns',
  {
    scopeKey: text('scope_key').primaryKey(),
    provider: text('provider').notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'provider_dispatch_cooldowns_scope_key_check',
      sql`length(${table.scopeKey}) = 64`,
    ),
  ],
)
