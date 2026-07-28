import 'server-only'
import os from 'node:os'
import { validateGeminiKey } from './gemini-adapter'
import { validateMimoKey } from './mimo-adapter'
import {
  validateAsrProfile,
  validateTtsProfile,
} from './openai-compatible-audio-config'
import { validateOpenAiCompatibleProfile } from './openai-compatible-config'
import {
  httpSuffix,
  OK,
  reject,
  type ProviderSettingsOutcome,
} from './provider-settings-contract'
import { PROVIDER_REGISTRY, providerSupports } from './provider-registry'
import type { StepfunSettings } from './schemas'
import { validateKey } from './stepfun-adapter'

/**
 * 先验证后保存的全部闸门（AGENTS §7）。返回 `ok: true` 才允许调用
 * `applyProviderSettings`；ASR 的协商结果通过返回值的 `negotiated` 交给保存阶段。
 *
 * Key 未提交时既不校验也不改动已存 Key；只提交了才走校验门禁。
 */
export async function validateProviderSettings(
  input: StepfunSettings,
): Promise<ProviderSettingsOutcome> {
  const laneQuotas = checkLaneQuotas(input.laneQuotas)
  if (!laneQuotas.ok) return laneQuotas

  // 备选 provider 服务于 Director 文本会话的降级：纯音频端点切过去必然
  // 以 RouteContractError 失败，在保存前就拒掉（先验证后保存）。
  if (
    input.fallbackProvider != null
    && !providerSupports(input.fallbackProvider, 'text')
  ) {
    return reject(
      422,
      `${PROVIDER_REGISTRY[input.fallbackProvider].label} 不支持文本会话，不能作为备选 provider`,
      false,
    )
  }

  if (input.apiKey !== undefined && !(await validateKey(input.apiKey))) {
    return keyValidationError('StepFun')
  }

  const { apiKey: geminiApiKey, ...geminiSettings } = input.gemini ?? {}
  if (
    geminiApiKey !== undefined
    && !(await validateGeminiKey(geminiApiKey, geminiSettings))
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
    if (!validated.ok) return customOpenAiValidationError(validated)
  }

  if (input.customOpenAiTts) {
    const validated = await validateTtsProfile(input.customOpenAiTts)
    if (!validated.ok) {
      return reject(
        422,
        `自定义兼容 TTS 端点校验失败${httpSuffix(validated.status)}，`
        + '请检查端点、模型、音色与音频格式',
      )
    }
  }

  if (input.customOpenAiAsr) {
    const validated = await validateAsrProfile(input.customOpenAiAsr)
    if (!validated.ok) return asrValidationError(validated)
    return {
      ok: true,
      negotiated: {
        asr: {
          timestampMode: validated.timestampMode,
          verification: validated.verification,
        },
      },
    }
  }

  return OK
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
  return reject(422, `${provider} Key 校验失败 · 请检查 Key 是否正确`, false)
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

/**
 * 文案必须指出是哪个模型被拒：文本模型与视觉模型分别用各自的探针校验，
 * 合成一句「校验失败」会让用户改错字段。
 */
function customOpenAiValidationError(
  validation: { field: 'textModel' | 'visionModel'; status?: number },
): ProviderSettingsOutcome {
  const suffix = httpSuffix(validation.status)
  return reject(
    422,
    validation.field === 'visionModel'
      ? `OpenAI 兼容视觉模型未接受图像输入${suffix}，请填写支持图像的模型或清空该字段`
      : `OpenAI 兼容文本模型校验失败${suffix}，请检查端点、模型和 Key`,
  )
}

/**
 * ASR 失败分两类，文案必须区分：
 * - `transcription-rejected` 是端点拒绝了合成音探针，客户端据此弹窗并可改以
 *   `credentialOnly: true` 重新提交，因此额外回一个机器可读的 `reason`。
 * - `credential-rejected` 是连 `/models` 都不通，端点或 Key 本身有问题，
 *   此时「仅校验凭据」也不该放行，所以不给 `reason`。
 */
function asrValidationError(
  validation: {
    reason: 'transcription-rejected' | 'credential-rejected'
    status?: number
  },
): ProviderSettingsOutcome {
  const suffix = httpSuffix(validation.status)
  if (validation.reason === 'credential-rejected') {
    return reject(
      422,
      `自定义兼容 ASR 端点凭据校验失败${suffix}，请检查端点与 API Key`,
    )
  }
  return {
    ok: false,
    rejection: {
      status: 422,
      body: {
        ok: false,
        error: `自定义兼容 ASR 端点拒绝了转写校验${suffix}。`
          + '该校验使用一段无语音内容的合成音，部分端点会直接拒收；'
          + '可改为仅校验凭据后保存，此时字幕将按整段音频对齐。',
        reason: 'asr-transcription-rejected',
      },
    },
  }
}
