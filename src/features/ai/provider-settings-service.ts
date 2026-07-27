import 'server-only'
import os from 'node:os'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import {
  describeLaneQuotas,
  saveLaneQuotas,
} from '@/lib/queue/runtime-config'
import {
  describeStepfunConfig,
  getAiConfigDependencies,
  saveStepfunModelSettings,
} from './config'
import { validateGeminiKey } from './gemini-adapter'
import {
  describeGeminiConfig,
  saveGeminiApiKey,
  saveGeminiSettings,
} from './gemini-config'
import { validateMimoKey } from './mimo-adapter'
import {
  describeMimoConfig,
  saveMimoApiKey,
  saveMimoSettings,
} from './mimo-config'
import {
  describeDirectorRoutes,
  saveDirectorRoutes,
} from './model-routing'
import {
  describeOpenAiCompatibleProfile,
  saveOpenAiCompatibleProfile,
  validateOpenAiCompatibleProfile,
} from './openai-compatible-config'
import { RouteContractError } from './route-contract-error'
import type { StepfunSettings } from './schemas'
import { saveApiKey, validateKey } from './stepfun-adapter'

/**
 * 设置面 Provider 写入的应用层编排。
 *
 * `src/app/api/settings/route.ts` 只做 JSON 解析、schema 校验与响应映射；
 * 「哪些闸门、什么顺序、失败回什么状态码」属于业务状态机，必须留在 features 层
 * （AGENTS §3）。顺序本身是合同：任何一道校验失败都不得落下任何 secret、模型、
 * 路由或配额写入（AGENTS §7）。
 */

/** 被拒绝时的完整响应体，形状与历史响应逐字一致，避免客户端解析口径漂移。 */
export interface ProviderSettingsRejection {
  status: 400 | 422
  body: { ok: false; valid?: false; error: string }
}

export type ProviderSettingsOutcome =
  | { ok: true }
  | { ok: false; rejection: ProviderSettingsRejection }

const OK: ProviderSettingsOutcome = { ok: true }

function reject(
  status: 400 | 422,
  error: string,
  valid?: false,
): ProviderSettingsOutcome {
  return {
    ok: false,
    rejection: {
      status,
      body: valid === undefined ? { ok: false, error } : { ok: false, valid, error },
    },
  }
}

/**
 * 先验证后保存的全部闸门。返回 `ok: true` 才允许调用 `applyProviderSettings`。
 *
 * Key 未提交时既不校验也不改动已存 Key；只提交了才走校验门禁。
 */
export async function validateProviderSettings(
  input: StepfunSettings,
): Promise<ProviderSettingsOutcome> {
  const laneQuotas = checkLaneQuotas(input.laneQuotas)
  if (!laneQuotas.ok) return laneQuotas

  if (input.apiKey !== undefined && !(await validateKey(input.apiKey))) {
    return keyValidationError('StepFun')
  }

  const { apiKey: geminiApiKey, ...geminiSettings } = input.gemini ?? {}
  if (
    geminiApiKey !== undefined &&
    !(await validateGeminiKey(geminiApiKey, geminiSettings))
  ) {
    return keyValidationError('Gemini')
  }

  const { apiKey: mimoApiKey, ...mimoSettings } = input.mimo ?? {}
  if (mimoApiKey !== undefined) {
    const validation = await validateMimoKey(mimoApiKey, mimoSettings)
    if (!validation.ok) return mimoValidationError(validation.reason)
  }

  if (input.customOpenAi) {
    const validated = await validateOpenAiCompatibleProfile(input.customOpenAi)
    if (!validated.ok) {
      return reject(
        422,
        'OpenAI 兼容模型服务校验失败，请检查端点、模型和 Key',
      )
    }
  }

  return OK
}

/**
 * 执行写入。路由先落：`saveDirectorRoutes` 的能力合同错误属于设置面矛盾，
 * 必须在任何模型 / secret / 配额写入之前把整个请求拒掉。
 *
 * 非 `RouteContractError` 的异常继续向上抛，由 route 层变成 500——它代表基础设施
 * 故障，不能伪装成用户输入错误。
 */
export async function applyProviderSettings(
  input: StepfunSettings,
): Promise<ProviderSettingsOutcome> {
  const {
    apiKey,
    gemini,
    mimo,
    routes,
    laneQuotas,
    customOpenAi,
    ...modelSettings
  } = input
  try {
    if (routes) await saveDirectorRoutes(routes)
  } catch (error) {
    if (error instanceof RouteContractError) {
      return reject(422, error.message, false)
    }
    throw error
  }
  const { apiKey: geminiApiKey, ...geminiSettings } = gemini ?? {}
  const { apiKey: mimoApiKey, ...mimoSettings } = mimo ?? {}
  await saveStepfunModelSettings(modelSettings)
  await saveGeminiSettings(geminiSettings)
  await saveMimoSettings(mimoSettings)
  if (apiKey !== undefined) await saveApiKey(apiKey)
  if (geminiApiKey !== undefined) await saveGeminiApiKey(geminiApiKey)
  if (mimoApiKey !== undefined) await saveMimoApiKey(mimoApiKey)
  if (customOpenAi) {
    await saveOpenAiCompatibleProfile(customOpenAi, customOpenAiDependencies())
  }
  if (laneQuotas) {
    await saveLaneQuotas({
      directorStage: laneQuotas.directorStageConcurrency,
      renderShot: laneQuotas.renderShotConcurrency,
    })
  }
  return OK
}

/** GET 与 POST 共用的无 secret 投影。两侧必须同源，否则保存后 UI 会看到另一套口径。 */
export async function describeProviderSettings() {
  const credentials = getAiConfigDependencies().credentials
  const [
    stepfunCredential,
    geminiCredential,
    mimoCredential,
    models,
    gemini,
    mimo,
    routes,
    laneQuotas,
    customOpenAi,
  ] = await Promise.all([
    credentials.describe(LOCAL_WORKSPACE_ID, 'stepfun'),
    credentials.describe(LOCAL_WORKSPACE_ID, 'gemini'),
    credentials.describe(LOCAL_WORKSPACE_ID, 'mimo'),
    describeStepfunConfig(),
    describeGeminiConfig(),
    describeMimoConfig(),
    describeDirectorRoutes(),
    describeLaneQuotas(),
    describeCustomOpenAi(),
  ])
  return {
    ...stepfunCredential,
    models,
    geminiConfigured: geminiCredential.configured,
    geminiCredential,
    gemini,
    mimoCredential,
    mimo,
    routes,
    // ISSUE-011: 队列并发配额真值。优先级 DB > env > 代码默认，由 `runtime-config.ts` 统一提供。
    // `source = 'settings' | 'env' | 'default'` 让 UI 能透出真值来自哪里。
    laneQuotas,
    customOpenAi,
  }
}

/**
 * ISSUE-011: renderShot 上限依赖运行期 CPU 数，schema 无法静态表达上限——
 * 在写入任何 secret / models / routes / laneQuotas 之前做二次校验。
 */
function checkLaneQuotas(
  laneQuotas: StepfunSettings['laneQuotas'],
): ProviderSettingsOutcome {
  if (!laneQuotas) return OK
  const cpuCount = os.cpus().length
  return laneQuotas.renderShotConcurrency > cpuCount
    ? reject(400, `渲染并发数不可超过 CPU 核数 (${cpuCount})`)
    : OK
}

function keyValidationError(
  provider: 'StepFun' | 'Gemini',
): ProviderSettingsOutcome {
  return reject(
    422,
    `${provider} Key 校验失败 · 请检查 Key 是否正确`,
    false,
  )
}

function mimoValidationError(
  reason:
    | 'token-plan-not-for-backend'
    | 'invalid-key-format'
    | 'provider-failed',
): ProviderSettingsOutcome {
  const error = reason === 'token-plan-not-for-backend'
    ? 'MiMo Token Plan Key 仅用于编程工具，PurpleInk 后端请使用 sk- 产品 API Key'
    : reason === 'invalid-key-format'
      ? 'MiMo 产品 API Key 格式无效，请使用 sk- Key'
      : 'MiMo Key 校验失败，请检查产品 API Key、额度和端点'
  return reject(422, error, false)
}

function customOpenAiDependencies() {
  const dependencies = getAiConfigDependencies()
  if (!dependencies.openAiCompatibleProfiles) {
    throw new Error('OpenAI 兼容模型配置存储不可用')
  }
  return {
    credentials: dependencies.credentials,
    profileStore: dependencies.openAiCompatibleProfiles,
  }
}

async function describeCustomOpenAi() {
  return describeOpenAiCompatibleProfile(customOpenAiDependencies())
}
