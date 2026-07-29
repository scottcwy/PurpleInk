import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  redemptionBatches,
  redemptionCodes,
  aiInvocations,
  taskAttempts,
  usagePeriods,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/lib/db/schema/index'
import { createPgTestDatabase, type PgTestDatabase } from '@/lib/db/test/pg-test-database'

const getDbMock = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db/client')>()
  return { ...original, getDb: getDbMock }
})

const database = {} as PgTestDatabase
const WORKSPACE_ID = '30000000-0000-4000-8000-000000000001'
const USER_ID = '30000000-0000-4000-8000-000000000002'
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000003'
const INVOCATION_ID = '30000000-0000-4000-8000-000000000004'

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
  process.env.CVC_REDEMPTION_CODE_PEPPER = 'billing-pg-test-pepper'
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'billing-test',
    name: 'Billing Test',
  })
  await database.db.insert(users).values({
    id: USER_ID,
    email: 'billing@example.com',
    name: 'Billing Owner',
    passwordHash: 'not-used-in-this-test',
  })
  await database.db.insert(workspaceMembers).values({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: 'owner',
  })
})
afterAll(async () => database.close())

async function provision(now = new Date()): Promise<void> {
  const { provisionFreeEntitlement } = await import('./period-service')
  await database.db.transaction((tx) =>
    provisionFreeEntitlement(tx, WORKSPACE_ID, now))
}

async function seedCode(planKey: 'free' | 'plus' | 'pro' | 'max'): Promise<string> {
  const code = `CODE-${planKey}`
  const { hashRedemptionCode } = await import('./redemption')
  const [batch] = await database.db.insert(redemptionBatches).values({
    planKey,
    label: `${planKey} test`,
  }).returning()
  await database.db.insert(redemptionCodes).values({
    batchId: batch.id,
    codeHash: hashRedemptionCode(code),
  })
  return code
}

async function seedAttempt(): Promise<void> {
  await database.sql`
    INSERT INTO projects (
      workspace_id, id, title, script, workflow_version, export_settings
    ) VALUES (
      ${WORKSPACE_ID}, '30000000-0000-4000-8000-000000000010',
      'Billing Project', 'script', 'billing-v1', '{"schemaVersion":1}'::jsonb
    )
  `
  await database.sql`
    INSERT INTO pipeline_runs (
      workspace_id, id, project_id, workflow_version, fingerprint
    ) VALUES (
      ${WORKSPACE_ID}, '30000000-0000-4000-8000-000000000011',
      '30000000-0000-4000-8000-000000000010', 'billing-v1', repeat('a', 64)
    )
  `
  await database.sql`
    INSERT INTO task_attempts (
      workspace_id, id, run_id, task_id, entity_type, entity_id, attempt_no,
      fingerprint, checkpoint
    ) VALUES (
      ${WORKSPACE_ID}, ${ATTEMPT_ID},
      '30000000-0000-4000-8000-000000000011', 'cvc.billing.test',
      'project', '30000000-0000-4000-8000-000000000010', 1,
      repeat('b', 64), '{"schemaVersion":1}'::jsonb
    )
  `
}

it('seeds a queryable immutable managed rate card', async () => {
  const { getCurrentRateCard } = await import('./rate-card-repository')
  const card = await getCurrentRateCard({
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    capability: 'text',
    now: new Date('2026-07-29T00:00:00.000Z'),
  })
  expect(card).toMatchObject({
    version: 1,
    priceCurrency: 'USD',
    fxCnyMicrosPerCurrencyUnit: BigInt(7_200_000),
  })
  expect(card.prices).toEqual(expect.arrayContaining([
    expect.objectContaining({
      unitKind: 'output_token',
      unitPriceCnyMicros: BigInt(10_800_000),
    }),
  ]))
})

it('seeds the website composite workflow rate in the shared managed catalog', async () => {
  const { getCurrentRateCard } = await import('./rate-card-repository')
  const card = await getCurrentRateCard({
    provider: 'purpleink-engine',
    model: 'website-video-v1',
    capability: 'workflow',
    now: new Date('2026-07-30T12:00:00.000Z'),
  })
  expect(card).toMatchObject({
    version: 1,
    priceCurrency: 'CNY',
    fxCnyMicrosPerCurrencyUnit: BigInt(1_000_000),
  })
  expect(card.prices).toEqual([{
    unitKind: 'video_second',
    unitSize: BigInt(1),
    unitPriceCnyMicros: BigInt(120_000),
  }])
})

it('rolls an expired workspace into a fresh Free period', async () => {
  await provision(new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000))
  const { getCurrentPlanKey } = await import('./period-service')
  expect(await getCurrentPlanKey(WORKSPACE_ID)).toBe('free')
  const periods = await database.db.select().from(usagePeriods)
  expect(periods).toHaveLength(2)
  expect(periods.filter((period) => period.status === 'active')).toHaveLength(1)
})

it('does not consume a lower-tier code for an active higher entitlement', async () => {
  await provision()
  await database.db.update(workspaceEntitlements).set({
    planKey: 'pro',
    expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1_000),
  })
  const code = await seedCode('plus')
  const { redeemBillingCode } = await import('./redemption')
  const result = await runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    () => redeemBillingCode({ code, idempotencyKey: 'lower-tier-1' }),
  )
  expect(result).toEqual({ ok: false, code: 'lower_tier' })
  const [stored] = await database.db.select().from(redemptionCodes)
  expect(stored.consumedAt).toBeNull()
  expect(stored.consumedByWorkspaceId).toBeNull()
})

it('same-tier redemption extends entitlement without resetting the usage period', async () => {
  await provision()
  const [before] = await database.db.select().from(workspaceEntitlements)
  const code = await seedCode('free')
  const { redeemBillingCode } = await import('./redemption')
  const result = await runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    () => redeemBillingCode({ code, idempotencyKey: 'extend-1' }),
  )
  expect(result.ok).toBe(true)
  const [after] = await database.db.select().from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.workspaceId, WORKSPACE_ID))
  expect(after.expiresAt.getTime() - before.expiresAt.getTime())
    .toBe(30 * 24 * 60 * 60 * 1_000)
  expect(await database.db.select().from(usagePeriods)).toHaveLength(1)
})

it('allows only one workspace to consume a Max code concurrently', async () => {
  const secondWorkspaceId = '30000000-0000-4000-8000-000000000041'
  const secondUserId = '30000000-0000-4000-8000-000000000042'
  await provision()
  await database.db.insert(workspaces).values({
    id: secondWorkspaceId,
    slug: 'billing-test-second',
    name: 'Billing Test Second',
  })
  await database.db.insert(users).values({
    id: secondUserId,
    email: 'billing-second@example.com',
    name: 'Billing Owner Second',
    passwordHash: 'not-used-in-this-test',
  })
  await database.db.insert(workspaceMembers).values({
    workspaceId: secondWorkspaceId,
    userId: secondUserId,
    role: 'owner',
  })
  const { provisionFreeEntitlement } = await import('./period-service')
  await database.db.transaction((tx) =>
    provisionFreeEntitlement(tx, secondWorkspaceId, new Date()))
  const code = await seedCode('max')
  const { redeemBillingCode } = await import('./redemption')
  const results = await Promise.all([
    runInAuthContext(
      { workspaceId: WORKSPACE_ID, userId: USER_ID },
      () => redeemBillingCode({ code, idempotencyKey: 'max-race-1' }),
    ),
    runInAuthContext(
      { workspaceId: secondWorkspaceId, userId: secondUserId },
      () => redeemBillingCode({ code, idempotencyKey: 'max-race-2' }),
    ),
  ])
  expect(results.filter((result) => result.ok)).toHaveLength(1)
  expect(results.filter((result) =>
    !result.ok && result.code === 'redemption_unavailable')).toHaveLength(1)
  const [stored] = await database.db.select().from(redemptionCodes)
  expect(stored.consumedByWorkspaceId).not.toBeNull()
  const entitlements = await database.db.select().from(workspaceEntitlements)
  expect(entitlements.filter((item) => item.planKey === 'max')).toHaveLength(1)
  expect(entitlements.filter((item) => item.planKey === 'free')).toHaveLength(1)
  const maxPeriod = (await database.db.select().from(usagePeriods))
    .find((item) => item.planKey === 'max')
  expect(maxPeriod?.limitCnyMicros).toBe(BigInt(2_000_000_000))
})

it('atomically creates, reserves and idempotently settles an invocation', async () => {
  await provision()
  await seedAttempt()
  const { reserveManagedInvocation, settleManagedInvocation } = await import('./ledger')
  const reservation = {
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    idempotencyKey: 'managed-invocation-1',
    rateCardId: '20000000-0000-4000-8000-000000000001',
    maximumCostCnyMicros: BigInt(1_000),
    create: {
      attemptId: ATTEMPT_ID,
      invocationNo: 1,
      provider: 'stepfun',
      model: 'step-3.5-flash',
      inputHash: 'c'.repeat(64),
    },
  }
  await reserveManagedInvocation(reservation)
  await reserveManagedInvocation(reservation)
  let [period] = await database.db.select().from(usagePeriods)
  expect(period.reservedCnyMicros).toBe(BigInt(1_000))

  const settlement = {
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    actualCostCnyMicros: BigInt(600),
    usageStatus: 'reported' as const,
    usage: {
      schemaVersion: 1,
      kind: 'text',
      inputTokens: 10,
      outputTokens: 4,
    },
  }
  await settleManagedInvocation(settlement)
  await settleManagedInvocation(settlement)
  ;[period] = await database.db.select().from(usagePeriods)
  expect(period).toMatchObject({
    reservedCnyMicros: BigInt(0),
    usedCnyMicros: BigInt(600),
  })
  const [invocation] = await database.db.select().from(aiInvocations)
  expect(invocation).toMatchObject({
    runId: '30000000-0000-4000-8000-000000000011',
    taskId: 'cvc.billing.test',
    billingStatus: 'settled',
    settledCnyMicros: BigInt(600),
    status: 'succeeded',
  })
})

it('settles reserved invocations whose parent attempt is already terminal', async () => {
  await provision()
  await seedAttempt()
  const {
    reconcileOrphanedManagedInvocations,
    reserveManagedInvocation,
  } = await import('./ledger')
  await reserveManagedInvocation({
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    idempotencyKey: 'orphaned-managed-invocation-1',
    rateCardId: '20000000-0000-4000-8000-000000000001',
    maximumCostCnyMicros: BigInt(1_000),
    create: {
      attemptId: ATTEMPT_ID,
      invocationNo: 1,
      provider: 'mimo',
      model: 'mimo-v2.5',
      inputHash: '9'.repeat(64),
    },
  })
  await database.db
    .update(taskAttempts)
    .set({ status: 'failed', completedAt: new Date() })
    .where(eq(taskAttempts.id, ATTEMPT_ID))

  await expect(reconcileOrphanedManagedInvocations()).resolves.toEqual([
    INVOCATION_ID,
  ])
  await expect(reconcileOrphanedManagedInvocations()).resolves.toEqual([])

  const [invocation] = await database.db.select().from(aiInvocations)
  expect(invocation).toMatchObject({
    status: 'failed',
    billingStatus: 'settled',
    usageStatus: 'unavailable',
    reservedCnyMicros: BigInt(1_000),
    settledCnyMicros: BigInt(1_000),
  })
  const [period] = await database.db.select().from(usagePeriods)
  expect(period).toMatchObject({
    reservedCnyMicros: BigInt(0),
    usedCnyMicros: BigInt(1_000),
  })
})

it('does not oversell the final quota under concurrent reservations', async () => {
  await provision()
  await seedAttempt()
  await database.db.update(usagePeriods).set({
    limitCnyMicros: BigInt(1_000),
  })
  const { reserveManagedInvocation } = await import('./ledger')
  const results = await Promise.allSettled([
    reserveManagedInvocation({
      workspaceId: WORKSPACE_ID,
      invocationId: '30000000-0000-4000-8000-000000000021',
      idempotencyKey: 'concurrent-quota-1',
      rateCardId: '20000000-0000-4000-8000-000000000001',
      maximumCostCnyMicros: BigInt(700),
      create: {
        attemptId: ATTEMPT_ID,
        invocationNo: 1,
        provider: 'stepfun',
        model: 'step-3.5-flash',
        inputHash: 'e'.repeat(64),
      },
    }),
    reserveManagedInvocation({
      workspaceId: WORKSPACE_ID,
      invocationId: '30000000-0000-4000-8000-000000000022',
      idempotencyKey: 'concurrent-quota-2',
      rateCardId: '20000000-0000-4000-8000-000000000001',
      maximumCostCnyMicros: BigInt(700),
      create: {
        attemptId: ATTEMPT_ID,
        invocationNo: 2,
        provider: 'stepfun',
        model: 'step-3.5-flash',
        inputHash: 'f'.repeat(64),
      },
    }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  const [period] = await database.db.select().from(usagePeriods)
  expect(period.reservedCnyMicros).toBe(BigInt(700))
})

it('keeps concurrent reservation and settlement idempotent for one invocation', async () => {
  await provision()
  await seedAttempt()
  const { reserveManagedInvocation, settleManagedInvocation } = await import('./ledger')
  const reservation = {
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    idempotencyKey: 'concurrent-idempotency-1',
    rateCardId: '20000000-0000-4000-8000-000000000001',
    maximumCostCnyMicros: BigInt(1_000),
    create: {
      attemptId: ATTEMPT_ID,
      invocationNo: 1,
      provider: 'stepfun',
      model: 'step-3.5-flash',
      inputHash: '1'.repeat(64),
    },
  }
  await Promise.all([
    reserveManagedInvocation(reservation),
    reserveManagedInvocation(reservation),
  ])
  const settlement = {
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    actualCostCnyMicros: BigInt(600),
    usageStatus: 'reported' as const,
    usage: {
      schemaVersion: 1,
      kind: 'text',
      inputTokens: 10,
      outputTokens: 4,
    },
  }
  await Promise.all([
    settleManagedInvocation(settlement),
    settleManagedInvocation(settlement),
  ])
  const [period] = await database.db.select().from(usagePeriods)
  expect(period).toMatchObject({
    reservedCnyMicros: BigInt(0),
    usedCnyMicros: BigInt(600),
  })
  expect(await database.db.select().from(aiInvocations)).toHaveLength(1)
})

it('projects only settled calls and trusts only reported token usage', async () => {
  await provision()
  await seedAttempt()
  const [period] = await database.db.select().from(usagePeriods)
  const earlier = new Date('2026-07-29T01:00:00.000Z')
  const later = new Date('2026-07-29T02:00:00.000Z')
  await database.db.insert(aiInvocations).values([
    {
      workspaceId: WORKSPACE_ID,
      id: '30000000-0000-4000-8000-000000000031',
      runId: '30000000-0000-4000-8000-000000000011',
      attemptId: ATTEMPT_ID,
      taskId: 'cvc.billing.test',
      invocationNo: 1,
      status: 'succeeded',
      provider: 'stepfun',
      model: 'step-3.5-flash',
      inputHash: '2'.repeat(64),
      usagePeriodId: period.id,
      billingStatus: 'settled',
      settledCnyMicros: BigInt(100),
      usageStatus: 'reported',
      usage: {
        schemaVersion: 1,
        kind: 'text',
        inputTokens: 12,
        outputTokens: 3,
      },
      settledAt: earlier,
      completedAt: earlier,
    },
    {
      workspaceId: WORKSPACE_ID,
      id: '30000000-0000-4000-8000-000000000032',
      runId: '30000000-0000-4000-8000-000000000011',
      attemptId: ATTEMPT_ID,
      taskId: 'cvc.billing.test',
      invocationNo: 2,
      status: 'failed',
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      inputHash: '3'.repeat(64),
      usagePeriodId: period.id,
      billingStatus: 'settled',
      settledCnyMicros: BigInt(200),
      usageStatus: 'unavailable',
      usage: {
        schemaVersion: 1,
        kind: 'text',
        inputTokens: 999,
        outputTokens: 999,
      },
      settledAt: later,
      completedAt: later,
    },
    {
      workspaceId: WORKSPACE_ID,
      id: '30000000-0000-4000-8000-000000000033',
      runId: '30000000-0000-4000-8000-000000000011',
      attemptId: ATTEMPT_ID,
      taskId: 'cvc.billing.test',
      invocationNo: 3,
      status: 'cancelled',
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
      inputHash: '4'.repeat(64),
      usagePeriodId: period.id,
      billingStatus: 'released',
      settledCnyMicros: BigInt(0),
      usageStatus: 'reported',
      usage: {
        schemaVersion: 1,
        kind: 'text',
        inputTokens: 500,
        outputTokens: 500,
      },
      settledAt: new Date('2026-07-29T03:00:00.000Z'),
      completedAt: new Date('2026-07-29T03:00:00.000Z'),
    },
  ])
  const { getBillingProjection } = await import('./period-service')
  const projection = await runInAuthContext(
    { workspaceId: WORKSPACE_ID, userId: USER_ID },
    () => getBillingProjection(),
  )
  expect(projection.usage.invocationCount).toBe(2)
  expect(projection.providerCalls).toEqual({ stepfun: 1, mimo: 0, gemini: 1 })
  expect(projection.tokenUsage).toEqual({ inputTokens: 12, outputTokens: 3 })
  expect(projection.lastInvocationAt).toBe(later.toISOString())
})

it('audits a zero-priced managed invocation instead of bypassing the ledger', async () => {
  await provision()
  await seedAttempt()
  const { reserveManagedInvocation, settleManagedInvocation } = await import('./ledger')
  await reserveManagedInvocation({
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    idempotencyKey: 'managed-free-tts-1',
    rateCardId: '20000000-0000-4000-8000-000000000007',
    maximumCostCnyMicros: BigInt(0),
    create: {
      attemptId: ATTEMPT_ID,
      invocationNo: 1,
      provider: 'mimo',
      model: 'mimo-v2.5-tts',
      inputHash: 'd'.repeat(64),
    },
  })
  await settleManagedInvocation({
    workspaceId: WORKSPACE_ID,
    invocationId: INVOCATION_ID,
    actualCostCnyMicros: BigInt(0),
    usageStatus: 'reported',
    usage: { schemaVersion: 1, kind: 'tts', characters: 120 },
  })
  const [invocation] = await database.db.select().from(aiInvocations)
  expect(invocation).toMatchObject({
    billingStatus: 'settled',
    reservedCnyMicros: BigInt(0),
    settledCnyMicros: BigInt(0),
    usageStatus: 'reported',
  })
})
