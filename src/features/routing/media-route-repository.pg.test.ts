import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema/index'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import { PostgresProviderCredentialStore } from '@/features/credentials'
import { PostgresMediaRouteRepository } from './media-route-repository'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const originalMasterKey = process.env.CVC_CREDENTIAL_MASTER_KEY
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>
const client = postgres(requiredDatabaseUrl(), { max: 1 })
const db = drizzle(client, { schema })

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim()
  if (!value) throw new Error('TEST_DATABASE_URL is required')
  return value
}

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  process.env.CVC_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 11).toString('base64')
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${WORKSPACE_ID}, 'media-routes', 'Media Routes')
  `
})
afterAll(async () => {
  if (originalMasterKey === undefined) {
    delete process.env.CVC_CREDENTIAL_MASTER_KEY
  } else {
    process.env.CVC_CREDENTIAL_MASTER_KEY = originalMasterKey
  }
  await client.end({ timeout: 5 })
  await database.close()
})

it('is lazy and resolves TTS through the same encrypted credential store', async () => {
  const databaseProvider = vi.fn(async () => db)
  const credentials = new PostgresProviderCredentialStore(databaseProvider)
  const credentialSpy = vi.spyOn(credentials, 'loadSecret')
  const routes = new PostgresMediaRouteRepository(databaseProvider, credentials)
  expect(databaseProvider).not.toHaveBeenCalled()

  await credentials.save({
    workspaceId: WORKSPACE_ID,
    provider: 'stepfun',
    secret: 'media-secret',
    verifiedAt: new Date(),
  })
  await routes.save({
    workspaceId: WORKSPACE_ID,
    mediaTaskKind: 'tts',
    provider: 'stepfun',
    model: 'stepaudio-2.5-tts',
  })
  await expect(routes.resolve(WORKSPACE_ID, 'tts')).resolves.toMatchObject({
    provider: 'stepfun',
    model: 'stepaudio-2.5-tts',
    secret: 'media-secret',
  })
  expect(credentialSpy).toHaveBeenCalledWith(WORKSPACE_ID, 'stepfun')
})

it('accepts only tts/asr and increments route revision', async () => {
  const credentials = new PostgresProviderCredentialStore(async () => db)
  const routes = new PostgresMediaRouteRepository(async () => db, credentials)
  await expect(routes.save({
    workspaceId: WORKSPACE_ID,
    mediaTaskKind: 'tts',
    provider: 'stepfun',
    model: 'tts-v1',
  })).resolves.toMatchObject({ revision: 0 })
  await expect(routes.save({
    workspaceId: WORKSPACE_ID,
    mediaTaskKind: 'tts',
    provider: 'stepfun',
    model: 'tts-v2',
  })).resolves.toMatchObject({ revision: 1, model: 'tts-v2' })
  await expect(routes.save({
    workspaceId: WORKSPACE_ID,
    mediaTaskKind: 'asr',
    provider: 'stepfun',
    model: 'asr-v1',
  })).resolves.toMatchObject({ mediaTaskKind: 'asr' })
  await expect(routes.save({
    workspaceId: WORKSPACE_ID,
    mediaTaskKind: 'vision-qa' as never,
    provider: 'gemini',
    model: 'invalid',
  })).rejects.toThrow('Unsupported media task kind')
  await expect(routes.remove(WORKSPACE_ID, 'asr')).resolves.toBe(true)
  await expect(routes.find(WORKSPACE_ID, 'asr')).resolves.toBeNull()
})

it('returns null when no media route exists', async () => {
  const credentials = new PostgresProviderCredentialStore(async () => db)
  const routes = new PostgresMediaRouteRepository(async () => db, credentials)

  await expect(routes.find(WORKSPACE_ID, 'asr')).resolves.toBeNull()
  await expect(routes.resolve(WORKSPACE_ID, 'asr')).resolves.toBeNull()
})
