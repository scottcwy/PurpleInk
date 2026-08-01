import { sql, type SQL } from 'drizzle-orm'

/** 所有可能减少活跃全局管理员数量的事务必须先取得同一把锁。 */
const GLOBAL_ADMIN_MUTATION_LOCK_NAMESPACE = 'purpleink:global-admin-mutation'

export function globalAdminMutationLockSql(): SQL {
  return sql`select pg_advisory_xact_lock(hashtext(${GLOBAL_ADMIN_MUTATION_LOCK_NAMESPACE}))`
}
