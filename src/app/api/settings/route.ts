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

export const dynamic = 'force-dynamic'

export async function GET() {
  const credentials = getAiConfigDependencies().credentials
  const [
    stepfunCredential,
    geminiCredential,
    models,
    gemini,
    routes,
  ] = await Promise.all([
    credentials.describe(LOCAL_WORKSPACE_ID, 'stepfun'),
    credentials.describe(LOCAL_WORKSPACE_ID, 'gemini'),
    describeStepfunConfig(),
    describeGeminiConfig(),
    describeDirectorRoutes(),
  ])
  return NextResponse.json({
    ...stepfunCredential,
    models,
    geminiConfigured: geminiCredential.configured,
    geminiCredential,
    gemini,
    routes,
    // 渲染队列默认并发数 = CPU 核数（`in-process-queue.ts` 的 `start()` 默认值），当前不可配置。
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
    ...modelSettings
  } = parsed.data
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

  const credentials = getAiConfigDependencies().credentials
  const [stepfunCredential, geminiCredential, models, geminiView, routeView] =
    await Promise.all([
      credentials.describe(LOCAL_WORKSPACE_ID, 'stepfun'),
      credentials.describe(LOCAL_WORKSPACE_ID, 'gemini'),
      describeStepfunConfig(),
      describeGeminiConfig(),
      describeDirectorRoutes(),
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
