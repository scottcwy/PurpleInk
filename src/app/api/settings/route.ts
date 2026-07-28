import os from 'node:os'
import { NextResponse } from 'next/server'
import { applyProviderSettings } from '@/features/ai/provider-settings-apply'
import { describeProviderSettings } from '@/features/ai/provider-settings-projection'
import { validateProviderSettings } from '@/features/ai/provider-settings-validation'
import { stepfunSettingsSchema } from '@/features/ai/schemas'
import { withApiSession } from '@/features/auth/api-session'

export const dynamic = 'force-dynamic'

export function GET(): Promise<Response> {
  return withApiSession(async () =>
    NextResponse.json({
      ...(await describeProviderSettings()),
      // 渲染队列默认并发数 = CPU 核数（`in-process-queue.ts` 的 `start()` 默认值）。ISSUE-011 之后由
      // `laneQuotas.renderShot` 表达并可在 UI 配置；保留此字段为确保旧 settings-form 引用不破。
      renderConcurrency: Math.max(1, os.cpus().length),
    }),
  )
}

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request))
}

async function handlePost(request: Request) {
  const body: unknown = await request.json().catch(() => null)
  const parsed = stepfunSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? '输入无效' },
      { status: 400 },
    )
  }

  const validated = await validateProviderSettings(parsed.data)
  if (!validated.ok) {
    return NextResponse.json(validated.rejection.body, {
      status: validated.rejection.status,
    })
  }

  const applied = await applyProviderSettings(parsed.data, validated.negotiated)
  if (!applied.ok) {
    return NextResponse.json(applied.rejection.body, {
      status: applied.rejection.status,
    })
  }

  return NextResponse.json({
    ok: true,
    valid: true,
    ...(await describeProviderSettings()),
    // 配额改动落在 DB 后，需要重启 dev 进程才会被 InProcessQueue.lanes 重新读取——
    // 显式回传 `requiresRestart: true`，UI 必须据此如实说明，不得让用户以为已热生效。
    requiresRestart: Boolean(parsed.data.laneQuotas),
  })
}
