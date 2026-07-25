import { fileURLToPath } from 'node:url'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '@/lib/db/schema/index'

type SqlClient = ReturnType<typeof postgres>
type ReservedSql = Awaited<ReturnType<SqlClient['reserve']>>
type TestDb = PostgresJsDatabase<typeof schema>

export interface PgTestDatabase {
  db: TestDb
  sql: ReservedSql
  reset(): Promise<void>
  close(): Promise<void>
}

interface DatabaseState {
  client: SqlClient
  db: TestDb
  session: ReservedSql
  locked: boolean
  closed: boolean
}

const ADVISORY_LOCK_KEY = 1_129_921_347
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../migrations/pg', import.meta.url),
)

function requiredTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL?.trim()
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for Postgres tests')
  }
  return url
}

function ensureOpen(state: DatabaseState): void {
  if (state.closed) {
    throw new Error('Postgres test database is already closed')
  }
}

async function resetSession(
  session: ReservedSql,
  db: TestDb,
): Promise<void> {
  await session`DROP SCHEMA IF EXISTS public CASCADE`
  await session`DROP SCHEMA IF EXISTS drizzle CASCADE`
  await session`CREATE SCHEMA public`
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

async function closeState(state: DatabaseState): Promise<void> {
  if (state.closed) {
    return
  }
  state.closed = true
  let cleanupError: unknown
  if (state.locked) {
    try {
      await state.session`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`
      state.locked = false
    } catch (error) {
      cleanupError = error
    }
  }
  try {
    await state.session.release()
  } catch (error) {
    cleanupError ??= error
  }
  try {
    await state.client.end({ timeout: 5 })
  } catch (error) {
    cleanupError ??= error
  }
  if (cleanupError) {
    throw cleanupError
  }
}

async function cleanAfterFailure(
  state: DatabaseState,
  failure: unknown,
): Promise<never> {
  try {
    await closeState(state)
  } catch (cleanupError) {
    throw new AggregateError(
      [failure, cleanupError],
      'Postgres test database setup and cleanup both failed',
    )
  }
  throw failure
}

function databaseHandle(state: DatabaseState): PgTestDatabase {
  return {
    db: state.db,
    sql: state.session,
    async reset(): Promise<void> {
      ensureOpen(state)
      try {
        await resetSession(state.session, state.db)
      } catch (error) {
        await cleanAfterFailure(state, error)
      }
    },
    async close(): Promise<void> {
      await closeState(state)
    },
  }
}

export async function createPgTestDatabase(): Promise<PgTestDatabase> {
  const client = postgres(requiredTestDatabaseUrl(), { max: 2 })
  const db = drizzle(client, { schema })
  let session: ReservedSql
  try {
    session = await client.reserve()
  } catch (error) {
    await client.end({ timeout: 5 }).catch(() => undefined)
    throw error
  }
  const state: DatabaseState = {
    client,
    db,
    session,
    locked: false,
    closed: false,
  }
  try {
    await session`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`
    state.locked = true
    await resetSession(session, db)
    return databaseHandle(state)
  } catch (error) {
    return cleanAfterFailure(state, error)
  }
}
