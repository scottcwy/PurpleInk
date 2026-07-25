import path from 'node:path'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgresDatabase } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as postgresSchema from '@/lib/db/schema/index'

const POSTGRES_MIGRATIONS_DIR = path.join(
  process.cwd(),
  'src',
  'lib',
  'db',
  'migrations',
  'pg'
)

/** 显式应用已提交的 Postgres migrations；调用结束后总是关闭专用连接。 */
export async function migratePostgres(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const client = postgres(databaseUrl, { max: 1 })
  try {
    const db = drizzlePostgres(client, { schema: postgresSchema })
    await migratePostgresDatabase(db, {
      migrationsFolder: POSTGRES_MIGRATIONS_DIR,
    })
  } finally {
    await client.end()
  }
}
