import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { workspaces } from '@/lib/db/schema/index'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase

beforeAll(async () => {
  Object.assign(database, await createPgTestDatabase())
})

beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
})

afterAll(async () => {
  await database.close()
})

describe('runtime-config: lane quotas DB > env > default', () => {
  it('falls back to code defaults with no env and no DB row', async () => {
    // saveLaneQuotas 需 FK 父行；describeLaneQuotas 不需要，read-only。
    const { describeLaneQuotas } = await import('./runtime-config')
    const view = await describeLaneQuotas({})
    expect(view.directorStage.source).toBe('default')
    expect(view.renderShot.source).toBe('default')
    expect(view.directorStage.value).toBe(12)
    expect(view.renderShot.value).toBeGreaterThanOrEqual(1)
  })

  it('reads env overrides when DB is empty, marking source as env', async () => {
    const { describeLaneQuotas } = await import('./runtime-config')
    const view = await describeLaneQuotas({
      CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '7',
      CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '3',
    })
    expect(view.directorStage).toEqual({ value: 7, source: 'env' })
    expect(view.renderShot).toEqual({ value: 3, source: 'env' })
  })

  it('ignores illegal env (non-integer / negative / empty) by falling back to default', async () => {
    const { describeLaneQuotas } = await import('./runtime-config')
    const view = await describeLaneQuotas({
      CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '1.5',
      CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '-1',
    })
    expect(view.directorStage.source).toBe('default')
    expect(view.renderShot.source).toBe('default')
  })

  it('persists saveLaneQuotas to workspace_settings, DB overrides env', async () => {
    const { describeLaneQuotas, saveLaneQuotas } = await import('./runtime-config')
    await seedWorkspace()
    await saveLaneQuotas({ directorStage: 5, renderShot: 2 })

    const view = await describeLaneQuotas({
      CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '7',
      CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '3',
    })
    expect(view.directorStage).toEqual({ value: 5, source: 'settings' })
    expect(view.renderShot).toEqual({ value: 2, source: 'settings' })
  })

  it('saveLaneQuotas is idempotent: a second write overwrites the first', async () => {
    const { describeLaneQuotas, saveLaneQuotas } = await import('./runtime-config')
    await seedWorkspace()
    await saveLaneQuotas({ directorStage: 6, renderShot: 2 })
    await saveLaneQuotas({ directorStage: 4, renderShot: 1 })

    const view = await describeLaneQuotas({})
    expect(view.directorStage).toEqual({ value: 4, source: 'settings' })
    expect(view.renderShot).toEqual({ value: 1, source: 'settings' })
  })

  it('saveLaneQuotas rejects zero / negative / non-integer', async () => {
    await seedWorkspace()
    const { saveLaneQuotas } = await import('./runtime-config')
    await expect(
      saveLaneQuotas({ directorStage: 0, renderShot: 1 }),
    ).rejects.toThrow()
    await expect(
      saveLaneQuotas({ directorStage: 1, renderShot: -1 }),
    ).rejects.toThrow()
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      saveLaneQuotas({ directorStage: 1.5, renderShot: 1 } as any),
    ).rejects.toThrow()
  })

  it('loadLaneQuotasForStart returns DB overrides when present, env otherwise', async () => {
    const { loadLaneQuotasForStart, saveLaneQuotas } = await import('./runtime-config')
    expect(await loadLaneQuotasForStart({})).toEqual({})

    expect(await loadLaneQuotasForStart({
      CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '7',
    })).toEqual({ 'director-stage': 7 })

    await seedWorkspace()
    await saveLaneQuotas({ directorStage: 4, renderShot: 2 })
    const lanes = await loadLaneQuotasForStart({
      CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '7',
      CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '8',
    })
    expect(lanes).toEqual({ 'director-stage': 4, 'render-shot': 2 })
  })
})

async function seedWorkspace(): Promise<void> {
  await database.db
    .insert(workspaces)
    .values({
      id: LOCAL_WORKSPACE_ID,
      slug: `local-${randomUUID().slice(0, 8)}`,
      name: 'Local workspace',
    })
    .onConflictDoNothing()
}