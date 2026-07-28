import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  redemptionBatches,
  redemptionCodes,
  aiInvocations,
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

async function seedCode(planKey: 'free' | 'plus' | 'pro'): Promise<string> {
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
