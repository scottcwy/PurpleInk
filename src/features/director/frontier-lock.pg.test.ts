import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { tryProjectFrontierLock } from './frontier-lock'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

afterAll(async () => {
  await database.close()
})

it('keeps concurrent frontier operations mutually exclusive', async () => {
  let active = 0
  let maximumActive = 0
  let executions = 0
  const operation = () => tryProjectFrontierLock(
    database.db,
    '00000000-0000-4000-8000-000000000301',
    async () => {
      executions += 1
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 30))
      active -= 1
    },
  )

  const results = await Promise.all([operation(), operation()])

  expect(maximumActive).toBe(1)
  expect(executions).toBe(2)
  expect(results.filter((result) => result !== null)).toHaveLength(2)
})

it('returns immediately when another database session owns the project lock', async () => {
  const projectId = '00000000-0000-4000-8000-000000000302'
  const lockKey = `director-frontier:${projectId}`
  await database.sql`
    select pg_advisory_lock(hashtextextended(${lockKey}, 0))
  `
  try {
    const operation = vi.fn()
    await expect(
      tryProjectFrontierLock(database.db, projectId, operation),
    ).resolves.toBeNull()
    expect(operation).not.toHaveBeenCalled()
  } finally {
    await database.sql`
      select pg_advisory_unlock(hashtextextended(${lockKey}, 0))
    `
  }
})
