import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  aiInvocations,
  usagePeriods,
  users,
  type VersionedPayload,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema'
import {
  createPgTestDatabase,
  type PgTestDatabase,
} from '@/lib/db/test/pg-test-database'
import { getAiUsageProjection } from './service'

const getDbMock = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const USER_A = '41000000-0000-4000-8000-000000000001'
const USER_B = '41000000-0000-4000-8000-000000000002'
const WORKSPACE_A = '41000000-0000-4000-8000-000000000011'
const WORKSPACE_B = '41000000-0000-4000-8000-000000000012'
const database = {} as PgTestDatabase
let periodId = ''

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
  await seedAccounts()
  periodId = randomUUID()
  const now = Date.now()
  await database.db.insert(usagePeriods).values({
    workspaceId: WORKSPACE_A,
    id: periodId,
    planKey: 'plus',
    startsAt: new Date(now - 2 * 86_400_000),
    endsAt: new Date(now + 28 * 86_400_000),
    limitCnyMicros: BigInt(1_000),
    usedCnyMicros: BigInt(200),
  })
})
afterAll(async () => database.close())

it('aggregates one actor across workspaces without mixing collaborators', async () => {
  const now = new Date()
  await insertInvocation({
    workspaceId: WORKSPACE_A,
    actorUserId: USER_A,
    funding: 'managed',
    usagePeriodId: periodId,
    provider: 'stepfun',
    usage: textUsage(10, 4),
    settledCnyMicros: BigInt(100),
    startedAt: new Date(now.getTime() - 1_000),
  })
  await insertInvocation({
    workspaceId: WORKSPACE_B,
    actorUserId: USER_A,
    funding: 'custom',
    provider: 'openai-compatible',
    usage: textUsage(6, 2),
    startedAt: now,
  })
  await insertInvocation({
    workspaceId: WORKSPACE_A,
    actorUserId: USER_B,
    funding: 'byok',
    provider: 'gemini',
    usage: textUsage(100, 100),
    startedAt: now,
  })

  const projection = await inContext(WORKSPACE_A, USER_A, () =>
    getAiUsageProjection({
      userId: USER_A,
      view: 'account',
      range: '7d',
      timeZone: 'Asia/Shanghai',
    }))

  expect(projection.summary.actualCalls).toBe(2)
  expect(projection.summary.reportedTokens.total).toBe(22)
  expect(projection.breakdown.funding).toEqual([
    expect.objectContaining({ key: 'custom', calls: 1 }),
    expect.objectContaining({ key: 'managed', calls: 1 }),
  ])
  expect(projection.series.reduce(
    (total, day) => total + day.managedCalls + day.ownApiCalls,
    0,
  )).toBe(2)
})

it('keeps trustworthy managed history in quota but out of actual-call totals', async () => {
  const now = new Date()
  await insertInvocation({
    workspaceId: WORKSPACE_A,
    actorUserId: USER_A,
    funding: 'managed',
    usagePeriodId: periodId,
    provider: 'stepfun',
    usage: textUsage(5, 5),
    settledCnyMicros: BigInt(100),
    startedAt: now,
  })
  await insertInvocation({
    workspaceId: WORKSPACE_A,
    actorUserId: null,
    funding: 'managed',
    usagePeriodId: periodId,
    provider: 'mimo',
    usage: { schemaVersion: 1, kind: 'text', inputTokens: 50 },
    settledCnyMicros: BigInt(100),
    startedAt: null,
    telemetryVersion: 1,
  })
  await insertInvocation({
    workspaceId: WORKSPACE_A,
    actorUserId: null,
    funding: 'byok',
    provider: 'gemini',
    usage: null,
    startedAt: null,
    telemetryVersion: 1,
  })

  const projection = await inContext(WORKSPACE_A, USER_A, () =>
    getAiUsageProjection({
      userId: USER_A,
      view: 'managed-cycle',
      range: 'cycle',
      timeZone: 'UTC',
    }))

  expect(projection.summary.actualCalls).toBe(1)
  expect(projection.summary.reportedTokens.total).toBe(10)
  expect(projection.series.at(-1)?.cumulativePercent).toBe(20)
  expect(projection.coverage).toMatchObject({
    includesManagedHistory: true,
    byokHistoryMissing: true,
  })
  const serialized = JSON.stringify(projection)
  expect(serialized).not.toMatch(
    /settledCnyMicros|inputHash|prompt|credential|failureKind/i,
  )
})

async function seedAccounts(): Promise<void> {
  await database.db.insert(users).values([
    user(USER_A, 'usage-a@example.test'),
    user(USER_B, 'usage-b@example.test'),
  ])
  await database.db.insert(workspaces).values([
    workspace(WORKSPACE_A, 'usage-a'),
    workspace(WORKSPACE_B, 'usage-b'),
  ])
  await database.db.insert(workspaceMembers).values([
    { workspaceId: WORKSPACE_A, userId: USER_A, role: 'owner' },
    { workspaceId: WORKSPACE_A, userId: USER_B, role: 'member' },
    { workspaceId: WORKSPACE_B, userId: USER_A, role: 'owner' },
  ])
}

async function insertInvocation(input: {
  workspaceId: string
  actorUserId: string | null
  funding: 'managed' | 'byok' | 'custom'
  provider: string
  usage: VersionedPayload | null
  startedAt: Date | null
  usagePeriodId?: string
  settledCnyMicros?: bigint
  telemetryVersion?: 1 | 2
}): Promise<void> {
  const completedAt = input.startedAt ?? new Date()
  await database.db.insert(aiInvocations).values({
    workspaceId: input.workspaceId,
    id: randomUUID(),
    invocationNo: 1,
    status: 'succeeded',
    provider: input.provider,
    model: 'test-model',
    actorUserId: input.actorUserId,
    funding: input.funding,
    capability: 'text',
    operation: 'workflow',
    telemetryVersion: input.telemetryVersion ?? 2,
    usage: input.usage ?? undefined,
    usageStatus: input.usage ? 'reported' : 'unavailable',
    usagePeriodId: input.usagePeriodId,
    billingStatus: input.funding === 'managed' ? 'settled' : 'not_applicable',
    settledCnyMicros: input.settledCnyMicros,
    providerStartedAt: input.startedAt,
    providerCompletedAt: input.startedAt ? completedAt : null,
    providerDurationMs: input.startedAt ? 20 : null,
    settledAt: completedAt,
    completedAt,
  })
}

function textUsage(inputTokens: number, outputTokens: number) {
  return {
    schemaVersion: 2,
    capability: 'text',
    kind: 'text',
    inputTokens,
    outputTokens,
  }
}

function user(id: string, email: string) {
  return { id, email, name: email, passwordHash: 'test-only-hash' }
}

function workspace(id: string, slug: string) {
  return { id, slug, name: slug }
}

function inContext<T>(
  workspaceId: string,
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return runInAuthContext({ workspaceId, userId }, operation)
}
