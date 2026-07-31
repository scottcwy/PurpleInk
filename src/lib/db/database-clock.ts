import { sql, type SQL } from 'drizzle-orm'

interface ClockTransaction {
  execute(query: SQL): Promise<unknown>
}

export async function readDatabaseClock(
  transaction: ClockTransaction,
): Promise<Date> {
  const result = await transaction.execute(sql`SELECT now() AS "ts"`)
  const row = Array.isArray(result) ? result[0] : undefined
  const raw = row && typeof row === 'object'
    ? (row as Record<string, unknown>).ts
    : undefined
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
  if (typeof raw === 'string') {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  throw new Error('DATABASE_CLOCK_UNAVAILABLE')
}
