import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInAuthContext } from '@/lib/auth/workspace-context'
import {
  aiInvocations,
  apiAccessCounters,
  redemptionCodes,
  users,
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
const WORKSPACE_ID = '40000000-0000-4000-8000-000000000001'
const USER_ID = '40000000-0000-4000-8000-000000000002'

beforeAll(async () => Object.assign(database, await createPgTestDatabase()))
beforeEach(async () => {
  await database.reset()
  getDbMock.mockReset()
  getDbMock.mockResolvedValue(database.db)
  process.env.CVC_REDEMPTION_CODE_PEPPER = 'admin-v2-pg-test-pepper'
  await database.db.insert(workspaces).values({
    id: WORKSPACE_ID,
    slug: 'admin-v2-test',
    name: 'Admin V2 Test',
  })
  await database.db.insert(users).values({
    id: USER_ID,
    email: 'adminv2@example.com',
    name: 'Admin V2 Owner',
    passwordHash: 'not-used',
  })
  await database.db.insert(workspaceMembers).values({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: 'owner',
  })
})
afterAll(async () => database.close())

// 真实用户注册时就会 provision free entitlement；先建好，避免 redeem 时
// 自动建 free 与随即升级同一 now 插两条 usage_period 撞主键。
async function provisionFree(now = new Date()): Promise<void> {
  const { provisionFreeEntitlement } = await import('@/features/billing/period-service')
  await database.db.transaction((tx) => provisionFreeEntitlement(tx, WORKSPACE_ID, now))
}

describe('recordApiAccess', () => {
  it('按分钟窗口原子累加同 routeGroup/outcome 的计数', async () => {
    const { recordApiAccess } = await import('./access-log')
    await recordApiAccess('GET /api/x', 200)
    await recordApiAccess('GET /api/x', 204)
    await recordApiAccess('GET /api/x', 404)

    const rows = await database.db.select().from(apiAccessCounters)
    const byOutcome = new Map(rows.map((row) => [row.outcome, row.count]))
    expect(byOutcome.get('2xx')).toBe(2)
    expect(byOutcome.get('404')).toBe(1)
  })

  it('归类：401/404 独立，>=500 归 5xx，其余 4xx 归 4xx', async () => {
    const { classifyOutcome } = await import('./access-log')
    expect(classifyOutcome(200)).toBe('2xx')
    expect(classifyOutcome(401)).toBe('401')
    expect(classifyOutcome(404)).toBe('404')
    expect(classifyOutcome(403)).toBe('4xx')
    expect(classifyOutcome(500)).toBe('5xx')
  })

  it('打点失败被吞掉，绝不向调用方抛出', async () => {
    const { recordApiAccess } = await import('./access-log')
    getDbMock.mockRejectedValueOnce(new Error('db down'))
    await expect(recordApiAccess('GET /api/x', 200)).resolves.toBeUndefined()
  })
})

describe('createRedemptionBatch / revokeRedemptionBatch', () => {
  it('生成 N 个格式合规且唯一的明文码，落库只存哈希', async () => {
    const { createRedemptionBatch } = await import('@/features/billing')
    const result = await createRedemptionBatch({
      planKey: 'plus',
      count: 5,
      label: '春节推广',
      createdByUserId: USER_ID,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.codes).toHaveLength(5)
    expect(new Set(result.codes).size).toBe(5)
    for (const code of result.codes) {
      expect(code).toMatch(/^PINK-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    }
    const stored = await database.db
      .select()
      .from(redemptionCodes)
      .where(eq(redemptionCodes.batchId, result.batchId))
    expect(stored).toHaveLength(5)
    // 落库的是 64 位哈希，不是明文。
    for (const row of stored) {
      expect(row.codeHash).toHaveLength(64)
      expect(result.codes).not.toContain(row.codeHash)
    }
  })

  it('拒绝非法套餐 / 数量 / 空标签', async () => {
    const { createRedemptionBatch } = await import('@/features/billing')
    expect(await createRedemptionBatch({ planKey: 'free', count: 1, label: 'x' })).toEqual({
      ok: false,
      code: 'invalid_plan',
    })
    expect(await createRedemptionBatch({ planKey: 'plus', count: 0, label: 'x' })).toEqual({
      ok: false,
      code: 'invalid_count',
    })
    expect(await createRedemptionBatch({ planKey: 'plus', count: 1, label: '  ' })).toEqual({
      ok: false,
      code: 'invalid_label',
    })
  })

  it('生成的码可被 redeemBillingCode 正常消费', async () => {
    const { createRedemptionBatch, redeemBillingCode } = await import('@/features/billing')
    await provisionFree()
    const batch = await createRedemptionBatch({
      planKey: 'plus',
      count: 1,
      label: '可兑换',
      createdByUserId: USER_ID,
    })
    expect(batch.ok).toBe(true)
    if (!batch.ok) return
    const result = await runInAuthContext(
      { workspaceId: WORKSPACE_ID, userId: USER_ID },
      () => redeemBillingCode({ code: batch.codes[0]!, idempotencyKey: 'redeem-1' }),
    )
    expect(result.ok).toBe(true)
  })

  it('撤销批次后其下的码不可再兑换', async () => {
    const { createRedemptionBatch, revokeRedemptionBatch, redeemBillingCode } = await import(
      '@/features/billing'
    )
    const batch = await createRedemptionBatch({
      planKey: 'pro',
      count: 1,
      label: '待撤销',
      createdByUserId: USER_ID,
    })
    expect(batch.ok).toBe(true)
    if (!batch.ok) return
    const revoked = await revokeRedemptionBatch(batch.batchId)
    expect(revoked.ok).toBe(true)

    const result = await redeemBillingCode({
      code: batch.codes[0]!,
      idempotencyKey: 'redeem-revoked',
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    })
    expect(result).toEqual({ ok: false, code: 'redemption_unavailable' })
  })

  it('撤销不存在的批次返回 ok:false', async () => {
    const { revokeRedemptionBatch } = await import('@/features/billing')
    const result = await revokeRedemptionBatch('40000000-0000-4000-8000-0000000000ff')
    expect(result.ok).toBe(false)
  })
})

describe('getBillingOverview / listRedemptionBatches', () => {
  it('套餐分布覆盖全部 plan_key（默认 workspace 为 active free）', async () => {
    const { getBillingOverview } = await import('./billing-admin')
    // redeem 会为 workspace 建 free entitlement；这里先 provision 再建一个批次并消费。
    const { createRedemptionBatch, redeemBillingCode } = await import('@/features/billing')
    await provisionFree()
    const batch = await createRedemptionBatch({ planKey: 'plus', count: 1, label: 'ov' })
    if (!batch.ok) throw new Error('batch failed')
    await runInAuthContext(
      { workspaceId: WORKSPACE_ID, userId: USER_ID },
      () => redeemBillingCode({ code: batch.codes[0]!, idempotencyKey: 'ov-1' }),
    )
    const overview = await getBillingOverview()
    expect(overview.plans.map((plan) => plan.planKey)).toEqual(['free', 'plus', 'pro', 'max'])
    const plus = overview.plans.find((plan) => plan.planKey === 'plus')
    expect(plus?.activeWorkspaces).toBe(1)
  })

  it('批次列表带已用/总数比例', async () => {
    const { createRedemptionBatch, redeemBillingCode } = await import('@/features/billing')
    const { listRedemptionBatches } = await import('./billing-admin')
    await provisionFree()
    const batch = await createRedemptionBatch({ planKey: 'plus', count: 3, label: '比例' })
    if (!batch.ok) throw new Error('batch failed')
    await runInAuthContext(
      { workspaceId: WORKSPACE_ID, userId: USER_ID },
      () => redeemBillingCode({ code: batch.codes[0]!, idempotencyKey: 'ratio-1' }),
    )
    const list = await listRedemptionBatches({ page: 1, pageSize: 20 })
    expect(list.total).toBe(1)
    expect(list.batches[0]).toMatchObject({ totalCodes: 3, consumedCodes: 1, label: '比例' })
  })
})

describe('getAiAuditMetrics', () => {
  async function seedInvocation(overrides: {
    invocationNo: number
    status: string
    model?: string
    provider?: string
    settled?: bigint | null
    durationMs?: number | null
    failureKind?: string | null
  }): Promise<void> {
    await database.db.insert(aiInvocations).values({
      workspaceId: WORKSPACE_ID,
      invocationNo: overrides.invocationNo,
      status: overrides.status,
      provider: overrides.provider ?? 'gemini',
      model: overrides.model ?? 'gemini-3.1-flash',
      settledCnyMicros: overrides.settled ?? null,
      providerDurationMs: overrides.durationMs ?? null,
      failureKind: overrides.failureKind ?? null,
    })
  }

  it('聚合总量/成功率/成本/失败分布/top models', async () => {
    await seedInvocation({ invocationNo: 1, status: 'succeeded', settled: BigInt(2_000_000), durationMs: 800 })
    await seedInvocation({ invocationNo: 2, status: 'succeeded', settled: BigInt(1_000_000), durationMs: 1_200 })
    await seedInvocation({ invocationNo: 3, status: 'failed', model: 'gemini-flash-lite', failureKind: 'timeout' })
    await seedInvocation({
      invocationNo: 4,
      status: 'succeeded',
      provider: 'openai',
      model: 'gpt-x',
      settled: BigInt(3_000_000),
      durationMs: 400,
    })

    const { getAiAuditMetrics } = await import('./ai-audit')
    const metrics = await getAiAuditMetrics(30)

    expect(metrics.windowDays).toBe(30)
    expect(metrics.totalInvocations).toBe(4)
    expect(metrics.succeeded).toBe(3)
    expect(metrics.failed).toBe(1)
    expect(metrics.successRate).toBeCloseTo(3 / 4)
    // 2 + 1 + 3 微元 → 6 元。
    expect(metrics.totalCostCny).toBeCloseTo(6)
    expect(metrics.days).toHaveLength(30)
    // 今天那格应含 4 次调用。
    expect(metrics.days.at(-1)?.total).toBe(4)

    const failure = metrics.failures.find((row) => row.failureKind === 'timeout')
    expect(failure?.count).toBe(1)

    const gemini = metrics.topModels.find((row) => row.model === 'gemini-3.1-flash')
    expect(gemini?.count).toBe(2)
    expect(gemini?.avgDurationMs).toBeCloseTo(1_000)
  })

  it('无数据时成功率为 null、成本为 0、天数仍补齐', async () => {
    const { getAiAuditMetrics } = await import('./ai-audit')
    const metrics = await getAiAuditMetrics(7)
    expect(metrics.totalInvocations).toBe(0)
    expect(metrics.successRate).toBeNull()
    expect(metrics.totalCostCny).toBe(0)
    expect(metrics.days).toHaveLength(7)
  })
})
