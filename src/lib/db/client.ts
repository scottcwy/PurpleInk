import 'server-only'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as postgresSchema from '@/lib/db/schema/index'

const globalStore = globalThis as unknown as {
  __cvcPostgresClient?: Sql
  __cvcDbPromise?: Promise<Db>
}

export const LOCAL_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'

export type Db = PostgresJsDatabase<typeof postgresSchema>
export type PostgresDb = Db

/**
 * 惰性创建并复用进程内 Postgres 连接。模块 import 不连接、不迁移；初始化失败会
 * 关闭失败 client 并清除 rejected Promise，允许修复配置后重试。
 */
export function getDb(): Promise<Db> {
  if (!globalStore.__cvcDbPromise) {
    const pending = initializePostgresDb()
    globalStore.__cvcDbPromise = pending
    void pending.catch(() => {
      if (globalStore.__cvcDbPromise === pending) {
        delete globalStore.__cvcDbPromise
      }
    })
  }
  return globalStore.__cvcDbPromise
}

async function initializePostgresDb(): Promise<Db> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const client = postgres(databaseUrl)
  globalStore.__cvcPostgresClient = client
  try {
    await client`select 1`
    return drizzle(client, { schema: postgresSchema })
  } catch (error) {
    if (globalStore.__cvcPostgresClient === client) {
      delete globalStore.__cvcPostgresClient
    }
    await client.end().catch(() => undefined)
    throw error
  }
}
