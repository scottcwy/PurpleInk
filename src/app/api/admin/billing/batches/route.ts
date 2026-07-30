import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAdminSession } from '@/features/auth/api-session'
import {
  REDEEMABLE_PLAN_KEYS,
  REDEMPTION_BATCH_MAX,
  createRedemptionBatch,
} from '@/features/billing'

export const dynamic = 'force-dynamic'

const createBatchSchema = z.object({
  planKey: z.enum(REDEEMABLE_PLAN_KEYS),
  count: z.number().int().min(1).max(REDEMPTION_BATCH_MAX),
  label: z.string().trim().min(1).max(120),
})

/**
 * 建兑换码批次：成功返回明文码数组（仅此一次可见，落库只存哈希）。
 * 前端须提示"仅显示一次"。
 */
export function POST(request: Request): Promise<Response> {
  return withAdminSession(async (session) => {
    const body: unknown = await request.json().catch(() => null)
    const parsed = createBatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? '输入无效' },
        { status: 400 },
      )
    }
    const result = await createRedemptionBatch({
      planKey: parsed.data.planKey,
      count: parsed.data.count,
      label: parsed.data.label,
      createdByUserId: session.userId,
    })
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: '批次参数无效' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      batchId: result.batchId,
      planKey: result.planKey,
      label: result.label,
      codes: result.codes,
    })
  }, { routeGroup: 'POST /api/admin/billing/batches' })
}
