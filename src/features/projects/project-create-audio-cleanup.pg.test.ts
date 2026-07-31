import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { wavBytes } from '@/features/audio/wav.fixture'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import { createProjectWithSource } from './project-creation'
import { createProjectFromRequest } from './project-create-request'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const CREATION_KEY = '30000000-0000-4000-8000-000000000001'
const bytes = wavBytes({
  sampleRateHz: 48_000,
  channels: 1,
  sampleCount: 48_000,
})
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${WORKSPACE_ID}, 'audio-create-cleanup', 'Audio Create Cleanup')
  `
})
afterAll(async () => database.close())

it('does not delete a committed project source when the caller misses success', async () => {
  const responseLost = new Error('commit response lost')
  const storage = {
    put: vi.fn(async (key: string) => key),
    delete: vi.fn(async () => undefined),
  }

  await expect(
    createProjectFromRequest(audioRequest(), {
      database: database.db,
      storage,
      measureAudio: async () => ({
        container: 'wav',
        sampleRateHz: 48_000,
        sampleCount: 48_000,
        durationMs: 1_000,
      }),
      getWorkspaceId: () => WORKSPACE_ID,
      createId: randomUUID,
      createProject: async (input, dependencies) => {
        await createProjectWithSource(input, dependencies)
        throw responseLost
      },
    }),
  ).rejects.toBe(responseLost)

  expect(storage.delete).not.toHaveBeenCalled()
  const sources = await database.sql<{
    storage_key: string
  }[]>`
    SELECT source_payload ->> 'storageKey' AS storage_key
    FROM project_sources
    WHERE workspace_id = ${WORKSPACE_ID}
  `
  expect(sources).toEqual([{
    storage_key: storage.put.mock.calls[0]![0],
  }])
  const [cleanup] = await database.sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM storage_cleanup_requests
    WHERE workspace_id = ${WORKSPACE_ID}
  `
  expect(cleanup?.count).toBe(0)
})

function audioRequest(): Request {
  const form = new FormData()
  form.set('kind', 'audio')
  form.set(
    'file',
    new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }),
    'source.wav',
  )
  form.set('visualTheme', 'dark')
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'idempotency-key': CREATION_KEY },
    body: form,
  })
}
