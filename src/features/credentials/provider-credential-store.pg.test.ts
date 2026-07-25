import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@/lib/db/schema/index'
import { createPgTestDatabase } from '@/lib/db/test/pg-test-database'
import {
  PostgresProviderCredentialStore,
  type ProviderCredentialStore,
} from './provider-credential-store'

vi.mock('server-only', () => ({}))

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const MASTER_KEY = Buffer.alloc(32, 7).toString('base64')
const originalMasterKey = process.env.CVC_CREDENTIAL_MASTER_KEY
const database = {} as Awaited<ReturnType<typeof createPgTestDatabase>>
const client = postgres(requiredDatabaseUrl(), { max: 1 })
const db = drizzle(client, { schema })

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim()
  if (!value) throw new Error('TEST_DATABASE_URL is required')
  return value
}

async function seedWorkspace(): Promise<void> {
  await database.sql`
    INSERT INTO workspaces (id, slug, name)
    VALUES (${WORKSPACE_ID}, 'credential-tests', 'Credential Tests')
  `
}

function store(): ProviderCredentialStore {
  return new PostgresProviderCredentialStore(async () => db)
}

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  await seedWorkspace()
  process.env.CVC_CREDENTIAL_MASTER_KEY = MASTER_KEY
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

describe('PostgresProviderCredentialStore', registerProviderCredentialStoreTests)

function registerProviderCredentialStoreTests(): void {
  it('does not connect during module import or construction',
    doesNotConnectDuringConstruction)
  it('fails closed when the master key is absent or not canonical 32-byte base64',
    rejectsInvalidMasterKeys)
  it('round-trips AES-256-GCM while persisting only a versioned envelope',
    roundTripsEncryptedEnvelope)
  it('describes an imported legacy credential as configured but unverified',
    describesImportedCredential)
  it('authenticates envelope/key versions and fails closed after tampering',
    rejectsTamperedCredentials)
  it('returns a secret-free unconfigured description', describesMissingCredential)
}

function doesNotConnectDuringConstruction(): void {
  const databaseProvider = vi.fn(async () => db)
  new PostgresProviderCredentialStore(databaseProvider)
  expect(databaseProvider).not.toHaveBeenCalled()
}

async function rejectsInvalidMasterKeys(): Promise<void> {
  const credentialStore = store()
  delete process.env.CVC_CREDENTIAL_MASTER_KEY
  await expect(credentialStore.save({
    workspaceId: WORKSPACE_ID,
    provider: 'stepfun',
    secret: 'never-written',
    verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
  })).rejects.toThrow(/CVC_CREDENTIAL_MASTER_KEY/)

  process.env.CVC_CREDENTIAL_MASTER_KEY = Buffer.alloc(31).toString('base64')
  await expect(credentialStore.save({
    workspaceId: WORKSPACE_ID,
    provider: 'stepfun',
    secret: 'never-written',
    verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
  })).rejects.toThrow(/32-byte base64/)

  process.env.CVC_CREDENTIAL_MASTER_KEY = ` ${MASTER_KEY}`
  await expect(credentialStore.save({
    workspaceId: WORKSPACE_ID,
    provider: 'stepfun',
    secret: 'never-written',
    verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
  })).rejects.toThrow(/canonical 32-byte base64/)

  const rows = await database.sql`SELECT id FROM provider_credentials`
  expect(rows).toHaveLength(0)
}

async function roundTripsEncryptedEnvelope(): Promise<void> {
  const credentialStore = store()
  const secret = 'sk-中文-plain-secret'
  await credentialStore.save({
    workspaceId: WORKSPACE_ID,
    provider: 'stepfun',
    secret,
    verifiedAt: new Date('2026-07-25T01:02:03.000Z'),
  })

  await expect(
    credentialStore.loadSecret(WORKSPACE_ID, 'stepfun'),
  ).resolves.toBe(secret)
  const rows = await database.sql<{
    envelope_version: number
    ciphertext: Uint8Array
    nonce: Uint8Array
    auth_tag: Uint8Array
    key_version: string
  }[]>`
    SELECT envelope_version, ciphertext, nonce, auth_tag, key_version
    FROM provider_credentials
    WHERE workspace_id = ${WORKSPACE_ID} AND provider = 'stepfun'
  `
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ envelope_version: 1, key_version: 'v1' })
  expect(rows[0]?.nonce).toHaveLength(12)
  expect(rows[0]?.auth_tag).toHaveLength(16)
  expect(Buffer.from(rows[0]?.ciphertext ?? []).toString('utf8')).not.toContain(secret)

  const description = await credentialStore.describe(WORKSPACE_ID, 'stepfun')
  expect(description).toEqual({
    configured: true,
    verifiedAt: '2026-07-25T01:02:03.000Z',
    updatedAt: expect.any(String),
  })
  expect(Object.keys(description).sort()).toEqual(
    ['configured', 'updatedAt', 'verifiedAt'].sort(),
  )
}

async function describesImportedCredential(): Promise<void> {
  await database.sql`
    INSERT INTO provider_credentials (
      workspace_id,
      provider,
      envelope_version,
      ciphertext,
      nonce,
      auth_tag,
      key_version,
      verified_at
    )
    VALUES (
      ${WORKSPACE_ID},
      'stepfun',
      1,
      decode('00', 'hex'),
      decode(repeat('00', 12), 'hex'),
      decode(repeat('00', 16), 'hex'),
      'v1',
      NULL
    )
  `

  await expect(store().describe(WORKSPACE_ID, 'stepfun')).resolves.toEqual({
    configured: true,
    verifiedAt: null,
    updatedAt: expect.any(String),
  })
}

async function rejectsTamperedCredentials(): Promise<void> {
  const credentialStore = store()
  await credentialStore.save({
    workspaceId: WORKSPACE_ID,
    provider: 'gemini',
    secret: 'gemini-secret',
    verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
  })
  await database.sql`
    UPDATE provider_credentials
    SET key_version = 'v2'
    WHERE workspace_id = ${WORKSPACE_ID} AND provider = 'gemini'
  `
  await expect(
    credentialStore.loadSecret(WORKSPACE_ID, 'gemini'),
  ).rejects.toThrow('Provider credential authentication failed')

  await credentialStore.save({
    workspaceId: WORKSPACE_ID,
    provider: 'gemini',
    secret: 'gemini-secret',
    verifiedAt: new Date('2026-07-25T00:00:00.000Z'),
  })
  await database.sql`
    UPDATE provider_credentials
    SET auth_tag = decode(repeat('00', 16), 'hex')
    WHERE workspace_id = ${WORKSPACE_ID} AND provider = 'gemini'
  `

  await expect(
    credentialStore.loadSecret(WORKSPACE_ID, 'gemini'),
  ).rejects.toThrow('Provider credential authentication failed')
}

async function describesMissingCredential(): Promise<void> {
  await expect(store().describe(WORKSPACE_ID, 'missing')).resolves.toEqual({
    configured: false,
    verifiedAt: null,
    updatedAt: null,
  })
}
