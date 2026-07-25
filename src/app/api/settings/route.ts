import os from 'node:os'
import { NextResponse } from 'next/server'
import {
  describeStepfunConfig,
  getAiConfigDependencies,
  saveStepfunModelSettings,
} from '@/features/ai/config'
import {
  describeGeminiConfig,
  saveGeminiApiKey,
  saveGeminiSettings,
} from '@/features/ai/gemini-config'
import { validateGeminiKey } from '@/features/ai/gemini-adapter'
import {
  describeDirectorRoutes,
  saveDirectorRoutes,
} from '@/features/ai/model-routing'
import { stepfunSettingsSchema } from '@/features/ai/schemas'
import { saveApiKey, validateKey } from '@/features/ai/stepfun-adapter'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  describeLaneQuotas,
  saveLaneQuotas,
} from '@/lib/queue/runtime-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const credentials = getAiConfigDependencies().credentials
  const [
    stepfunCredential,
    geminiCredential,
    models,
    gemini,
    routes,
    laneQuotas,
  ] = await Promise.all([
    credentials.describe(LOCAL_WORKSPACE_ID, 'stepfun'),
    credentials.describe(LOCAL_WORKSPACE_ID, 'gemini'),
    describeStepfunConfig(),
    describeGeminiConfig(),
    describeDirectorRoutes(),
    describeLaneQuotas(),
  ])
  return NextResponse.json({
    ...stepfunCredential,
    models,
    geminiConfigured: geminiCredential.configured,
    geminiCredential,
    gemini,
    routes,
    // ISSUE-011: 队列并发配额真值。优先级 DB > env > 代码默认，由 `runtime-config.ts` 统一提供。
    // `source = 'settings' | 'env' | 'default'` 让 UI 能透出真值来自哪里。
    laneQuotas,
    // 渲染队列默认并发数 = CPU 核数（`in-process-queue.ts` 的 `start()` 默认值）。ISSUE-011 之后由
    // `laneQuotas.renderShot` 表达并可在 UI 配置；保留此字段为确保旧 settings-form 引用不破。
    renderConcurrency: Math.max(1, os.cpus().length),
  })
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null)
  const parsed = stepfunSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? '输入无效' },
      { status: 400 },
    )
  }
  const {
    apiKey,
    gemini,
    routes,
    laneQuotas,
    ...modelSettings
  } = parsed.data
  // ISSUE-011: renderShot 上限依赖运行期 CPU 数，schema 无法静态表达上限——
  // 在写入任何 secret / models / routes / laneQuotas 之前做二次校验，违反回 400 且不落任何写入。
  if (laneQuotas) {
    const cpuCount = os.cpus().length
    if (laneQuotas.renderShotConcurrency > cpuCount) {
      return NextResponse.json(
        {
          ok: false,
          error: `渲染并发数不可超过 CPU 核数 (${cpuCount})`,
        },
        { status: 400 },
      )
    }
  }
  // Key 未提交时不校验也不改动已存 Key；只提交了才走校验门禁（校验失败不得覆盖）。
  if (apiKey !== undefined && !(await validateKey(apiKey))) {
    return keyValidationError('StepFun')
  }
  const { apiKey: geminiApiKey, ...geminiSettings } = gemini ?? {}
  if (
    geminiApiKey !== undefined &&
    !(await validateGeminiKey(geminiApiKey, geminiSettings))
  ) {
    return keyValidationError('Gemini')
  }

  await saveStepfunModelSettings(modelSettings)
  await saveGeminiSettings(geminiSettings)
  if (routes) await saveDirectorRoutes(routes)
  if (apiKey !== undefined) await saveApiKey(apiKey)
  if (geminiApiKey !== undefined) await saveGeminiApiKey(geminiApiKey)
  if (laneQuotas) {
    await saveLaneQuotas({
      directorStage: laneQuotas.directorStageConcurrency,
      renderShot: laneQuotas.renderShotConcurrency,
    })
  }

  const credentials = getAiConfigDependencies().credentials
  const [stepfunCredential, geminiCredential, models, geminiView, routeView, laneQuotasView] =
    await Promise.all([
      credentials.describe(LOCAL_WORKSPACE_ID, 'stepfun'),
      credentials.describe(LOCAL_WORKSPACE_ID, 'gemini'),
      describeStepfunConfig(),
      describeGeminiConfig(),
      describeDirectorRoutes(),
      describeLaneQuotas(),
    ])
  return NextResponse.json({
    ok: true,
    valid: true,
    ...stepfunCredential,
    models,
    geminiConfigured: geminiCredential.configured,
    geminiCredential,
    gemini: geminiView,
    routes: routeView,
    // 配额改动落在 DB 后，需要重启 dev 进程才会被 InProcessQueue.lanes 重新读取——
    // 显式回传 `requiresRestart: true`，UI 必须据此如实说明，不得让用户以为已热生效。
    laneQuotas: laneQuotasView,
    requiresRestart: Boolean(laneQuotas),
  })
}

function keyValidationError(provider: 'StepFun' | 'Gemini') {
  return NextResponse.json(
    {
      ok: false,
      valid: false,
      error: `${provider} Key 校验失败 · 请检查 Key 是否正确`,
    },
    { status: 422 }
  )
}
