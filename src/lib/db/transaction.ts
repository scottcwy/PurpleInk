import type { Db } from './client'

export type TransactionContext = Parameters<
  Parameters<Db['transaction']>[0]
>[0]

/** 由 application service 显式划定跨 repository 的原子提交边界。 */
export function withTransaction<T>(
  database: Db,
  operation: (transaction: TransactionContext) => Promise<T>
): Promise<T> {
  return database.transaction(operation)
}
