import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { withProjectFrontierLock } from './frontier-lock'

vi.mock('server-only', () => ({}))

const database = {} as PgTestDatabase

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

afterAll(async () => {
  await database.close()
})

it('serializes concurrent frontier repairs for the same project', async () => {
  let active = 0
  let maximumActive = 0
  const operation = () => withProjectFrontierLock(
    database.db,
    '00000000-0000-4000-8000-000000000301',
    async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 30))
      active -= 1
    },
  )

  await Promise.all([operation(), operation()])

  expect(maximumActive).toBe(1)
})
