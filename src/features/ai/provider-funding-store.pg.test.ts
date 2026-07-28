import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema/index'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import { PostgresProviderFundingStore } from './provider-funding-store'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>
const client = postgres(requiredDatabaseUrl(), { max: 1 })
const db = drizzle(client, { schema })
const store = new PostgresProviderFundingStore(async () => db)

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim()
  if (!value) throw new Error('TEST_DATABASE_URL is required')
  return value
}

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${WORKSPACE_ID}, 'funding-tests', 'Funding Tests')
  `
})
afterAll(async () => {
  await client.end({ timeout: 5 })
  await database.close()
})

describe('PostgresProviderFundingStore', () => {
  it('defaults to managed and persists each built-in provider independently', async () => {
    await expect(store.find(WORKSPACE_ID, 'gemini')).resolves.toBe('managed')

    await store.save(WORKSPACE_ID, 'gemini', 'byok')
    await store.save(WORKSPACE_ID, 'stepfun', 'managed')

    await expect(store.find(WORKSPACE_ID, 'gemini')).resolves.toBe('byok')
    await expect(store.find(WORKSPACE_ID, 'stepfun')).resolves.toBe('managed')
    await expect(store.find(WORKSPACE_ID, 'mimo')).resolves.toBe('managed')
  })

  it('updates one source idempotently without duplicating workspace settings', async () => {
    await store.save(WORKSPACE_ID, 'mimo', 'byok')
    await store.save(WORKSPACE_ID, 'mimo', 'managed')

    const rows = await database.sql`
      SELECT key, value
      FROM workspace_settings
      WHERE workspace_id = ${WORKSPACE_ID}
        AND key = 'ai.funding.mimo'
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toMatchObject({ schemaVersion: 1, funding: 'managed' })
  })
})
