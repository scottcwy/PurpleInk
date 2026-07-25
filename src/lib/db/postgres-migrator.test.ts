import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const end = vi.fn(async (): Promise<void> => undefined)
  const client = { end }
  return {
    client,
    drizzlePostgres: vi.fn(() => ({ kind: 'postgres-db' })),
    end,
    migratePostgresDatabase: vi.fn(async (): Promise<void> => undefined),
    postgres: vi.fn(() => client),
  }
})

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: mocks.drizzlePostgres,
}))
vi.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: mocks.migratePostgresDatabase,
}))
vi.mock('postgres', () => ({ default: mocks.postgres }))
vi.mock('@/lib/db/schema/index', () => ({}))

async function loadMigrator() {
  vi.resetModules()
  return import('./migrate')
}

function expectClientClosedAfterMigration(): void {
  const migrationOrder =
    mocks.migratePostgresDatabase.mock.invocationCallOrder[0]
  const closeOrder = mocks.end.mock.invocationCallOrder[0]
  expect(migrationOrder).toBeDefined()
  expect(closeOrder).toBeGreaterThan(migrationOrder)
}

describe('Postgres migrator boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.end.mockResolvedValue(undefined)
    mocks.migratePostgresDatabase.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not connect, create a Drizzle client, or migrate on import', async () => {
    await loadMigrator()

    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(mocks.drizzlePostgres).not.toHaveBeenCalled()
    expect(mocks.migratePostgresDatabase).not.toHaveBeenCalled()
    expect(mocks.end).not.toHaveBeenCalled()
  })

  it('fails closed when DATABASE_URL is absent', async () => {
    vi.stubEnv('DATABASE_URL', '   ')
    const { migratePostgres } = await loadMigrator()

    await expect(migratePostgres()).rejects.toThrow(
      'DATABASE_URL is required'
    )
    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(mocks.drizzlePostgres).not.toHaveBeenCalled()
    expect(mocks.migratePostgresDatabase).not.toHaveBeenCalled()
  })

  it('runs tracked Postgres migrations and closes the dedicated client', async () => {
    const databaseUrl = 'configured-database-url'
    vi.stubEnv('DATABASE_URL', databaseUrl)
    const { migratePostgres } = await loadMigrator()

    await expect(migratePostgres()).resolves.toBeUndefined()

    expect(mocks.postgres).toHaveBeenCalledWith(databaseUrl, { max: 1 })
    expect(mocks.drizzlePostgres).toHaveBeenCalledWith(mocks.client, {
      schema: {},
    })
    expect(mocks.migratePostgresDatabase).toHaveBeenCalledWith(
      { kind: 'postgres-db' },
      {
        migrationsFolder: path.join(
          process.cwd(),
          'src',
          'lib',
          'db',
          'migrations',
          'pg'
        ),
      }
    )
    expect(mocks.end).toHaveBeenCalledOnce()
    expectClientClosedAfterMigration()
  })

  it('closes the client and propagates a migration failure', async () => {
    const migrationError = new Error('synthetic migration failure')
    vi.stubEnv('DATABASE_URL', 'configured-database-url')
    mocks.migratePostgresDatabase.mockRejectedValueOnce(migrationError)
    const { migratePostgres } = await loadMigrator()

    await expect(migratePostgres()).rejects.toBe(migrationError)
    expect(mocks.end).toHaveBeenCalledOnce()
    expectClientClosedAfterMigration()
  })
})
