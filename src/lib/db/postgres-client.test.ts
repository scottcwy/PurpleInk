import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  postgres: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('postgres', () => ({ default: mocks.postgres }))
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mocks.drizzle }))
vi.mock('@/lib/db/schema/index', () => ({}))

const globalStore = globalThis as Record<string, unknown>
const originalDatabaseUrl = process.env.DATABASE_URL

function clearDatabaseAnchors(): void {
  delete globalStore.__cvcPostgresClient
  delete globalStore.__cvcDbPromise
}

function restoreDatabaseUrl(): void {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
    return
  }
  process.env.DATABASE_URL = originalDatabaseUrl
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value: T) => resolvePromise?.(value),
  }
}

function createClient(connection: Promise<unknown>) {
  return Object.assign(vi.fn(() => connection), {
    end: vi.fn(() => Promise.resolve()),
  })
}

beforeEach(() => {
  clearDatabaseAnchors()
  delete process.env.DATABASE_URL
  vi.clearAllMocks()
  vi.resetModules()
})

afterAll(() => {
  clearDatabaseAnchors()
  restoreDatabaseUrl()
})

describe('Postgres client lifecycle', () => {
  it('has no database side effects during module import', async () => {
    await expect(import('./client')).resolves.toBeDefined()

    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(mocks.drizzle).not.toHaveBeenCalled()
  })

  it('fails closed before creating a client when DATABASE_URL is absent', async () => {
    const { getDb } = await import('./client')

    await expect(getDb()).rejects.toThrow('DATABASE_URL is required')

    expect(mocks.postgres).not.toHaveBeenCalled()
    expect(mocks.drizzle).not.toHaveBeenCalled()
  })

  it('reuses one pending promise and client for concurrent callers', async () => {
    process.env.DATABASE_URL = 'configured'
    const connection = deferred<unknown>()
    const client = createClient(connection.promise)
    const database = { kind: 'postgres' }
    mocks.postgres.mockReturnValue(client)
    mocks.drizzle.mockReturnValue(database)
    const { getDb } = await import('./client')

    const first = getDb()
    const second = getDb()

    expect(second).toBe(first)
    expect(mocks.postgres).toHaveBeenCalledTimes(1)
    expect(client).toHaveBeenCalledTimes(1)
    expect(mocks.drizzle).not.toHaveBeenCalled()

    connection.resolve([])
    await expect(first).resolves.toBe(database)
    expect(mocks.drizzle).toHaveBeenCalledTimes(1)
    expect(client.end).not.toHaveBeenCalled()
  })

  it('closes a failed client, clears the rejection, and retries after repair', async () => {
    process.env.DATABASE_URL = 'configured-before-repair'
    const failedClient = createClient(Promise.reject(new Error('connect failed')))
    const recoveredClient = createClient(Promise.resolve([]))
    const database = { kind: 'postgres' }
    mocks.postgres
      .mockReturnValueOnce(failedClient)
      .mockReturnValueOnce(recoveredClient)
    mocks.drizzle.mockReturnValue(database)
    const { getDb } = await import('./client')

    const failed = getDb()
    await expect(failed).rejects.toThrow('connect failed')
    await Promise.resolve()
    expect(failedClient.end).toHaveBeenCalledTimes(1)

    process.env.DATABASE_URL = 'configured-after-repair'
    const retry = getDb()
    expect(retry).not.toBe(failed)
    await expect(retry).resolves.toBe(database)
    expect(mocks.postgres).toHaveBeenCalledTimes(2)
    expect(recoveredClient.end).not.toHaveBeenCalled()
  })
})
