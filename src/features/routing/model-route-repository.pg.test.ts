import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema/index'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import { PostgresProviderCredentialStore } from '@/features/credentials'
import { PostgresModelRouteRepository } from './model-route-repository'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
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
  process.env.CVC_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 9).toString('base64')
  await database.sql`
    INSERT INTO workspaces (id, slug, name) VALUES
      (${WORKSPACE_ID}, 'model-routes', 'Model Routes'),
      (${OTHER_WORKSPACE_ID}, 'other-model-routes', 'Other Model Routes')
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

it('is lazy and resolves an AI route through the shared credential store', async () => {
  const databaseProvider = vi.fn(async () => db)
  const credentials = new PostgresProviderCredentialStore(databaseProvider)
  const credentialSpy = vi.spyOn(credentials, 'loadSecret')
  const routes = new PostgresModelRouteRepository(databaseProvider, credentials)
  expect(databaseProvider).not.toHaveBeenCalled()

  await credentials.save({
    workspaceId: WORKSPACE_ID,
    provider: 'stepfun',
    secret: 'shared-secret',
    verifiedAt: new Date(),
  })
  const saved = await routes.save({
    workspaceId: WORKSPACE_ID,
    aiTaskKind: 'project-plan',
    provider: 'stepfun',
    model: 'step-3.5-flash',
  })
  expect(saved.revision).toBe(0)
  await expect(routes.resolve(WORKSPACE_ID, 'project-plan')).resolves.toMatchObject({
    provider: 'stepfun',
    model: 'step-3.5-flash',
    secret: 'shared-secret',
  })
  expect(credentialSpy).toHaveBeenCalledWith(WORKSPACE_ID, 'stepfun')
})

it('accepts exactly four AI task kinds and increments revision on update', async () => {
  const credentials = new PostgresProviderCredentialStore(async () => db)
  const routes = new PostgresModelRouteRepository(async () => db, credentials)
  for (const aiTaskKind of [
    'project-plan',
    'shot-spec',
    'fabricate',
    'vision-qa',
  ] as const) {
    await expect(routes.save({
      workspaceId: WORKSPACE_ID,
      aiTaskKind,
      provider: 'gemini',
      model: `model-${aiTaskKind}`,
    })).resolves.toMatchObject({ aiTaskKind })
  }
  await expect(routes.save({
    workspaceId: WORKSPACE_ID,
    aiTaskKind: 'project-plan',
    provider: 'gemini',
    model: 'updated-model',
  })).resolves.toMatchObject({ revision: 1, model: 'updated-model' })
  await expect(routes.save({
    workspaceId: WORKSPACE_ID,
    aiTaskKind: 'tts' as never,
    provider: 'stepfun',
    model: 'invalid',
  })).rejects.toThrow('Unsupported AI task kind')
  await expect(routes.remove(WORKSPACE_ID, 'shot-spec')).resolves.toBe(true)
  await expect(routes.find(WORKSPACE_ID, 'shot-spec')).resolves.toBeNull()
})

it('keeps identical route kinds isolated by workspace', async () => {
  const credentials = new PostgresProviderCredentialStore(async () => db)
  const routes = new PostgresModelRouteRepository(async () => db, credentials)
  await routes.save({
    workspaceId: WORKSPACE_ID,
    aiTaskKind: 'fabricate',
    provider: 'stepfun',
    model: 'workspace-one',
  })
  await routes.save({
    workspaceId: OTHER_WORKSPACE_ID,
    aiTaskKind: 'fabricate',
    provider: 'gemini',
    model: 'workspace-two',
  })

  await expect(routes.find(WORKSPACE_ID, 'fabricate')).resolves.toMatchObject({
    model: 'workspace-one',
  })
  await expect(routes.find(OTHER_WORKSPACE_ID, 'fabricate')).resolves.toMatchObject({
    model: 'workspace-two',
  })
})
