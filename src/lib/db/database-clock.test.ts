import { describe, expect, it, vi } from 'vitest'
import { readDatabaseClock } from './database-clock'

describe('database clock', () => {
  it('uses PostgreSQL time and never falls back to the host clock', async () => {
    const databaseTime = new Date('2026-08-01T00:00:00.000Z')
    await expect(readDatabaseClock({
      execute: vi.fn(async () => [{ ts: databaseTime }]),
    })).resolves.toEqual(databaseTime)
    await expect(readDatabaseClock({
      execute: vi.fn(async () => []),
    })).rejects.toThrow('DATABASE_CLOCK_UNAVAILABLE')
  })
})
