import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import { deferProjectSourceCleanup } from './project-source-cleanup'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PROJECT_ID = '10000000-0000-4000-8000-000000000001'
const STORAGE_KEY =
  `project-sources/${WORKSPACE_ID}/${PROJECT_ID}/`
  + `${'a'.repeat(64)}.wav`
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${WORKSPACE_ID}, 'cleanup-test', 'Cleanup Test')
  `
})
afterAll(async () => database.close())

it('durably records one retryable cleanup request without raw failure content', async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await deferProjectSourceCleanup(
      {
        workspaceId: WORKSPACE_ID,
        storageKey: STORAGE_KEY,
        reason: 'duplicate-upload',
      },
      { database: database.db },
    )
  }

  const rows = await database.sql<{
    storage_key: string
    reason: string
    attempt_count: number
  }[]>`
    SELECT storage_key, reason, attempt_count
    FROM storage_cleanup_requests
  `
  expect(rows).toEqual([{
    storage_key: STORAGE_KEY,
    reason: 'duplicate-upload',
    attempt_count: 0,
  }])
  expect(JSON.stringify(rows)).not.toContain('storage offline')
})
