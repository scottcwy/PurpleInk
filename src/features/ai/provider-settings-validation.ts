import 'server-only'
import os from 'node:os'
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
import { PROVIDER_REGISTRY } from './provider-registry'
import type { ProviderSettings } from './schemas'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { getAiConfigDependencies } from './config'
import type { ManagedProviderId } from './managed-service'
import { createAuditedValidationFetcher } from './validation-fetch'
import { validateOfficialByokKey } from './official-provider-validation'

/**
 * 先验证后保存的全部闸门（AGENTS §7）。返回 `ok: true` 才允许调用
 * `applyProviderSettings`；ASR 的协商结果通过返回值的 `negotiated` 交给保存阶段。
 *
 * Key 未提交时既不校验也不改动已存 Key；只提交了才走校验门禁。
 */
export async function validateProviderSettings(
  input: ProviderSettings,
): Promise<ProviderSettingsOutcome> {
  const laneQuotas = checkLaneQuotas(input.laneQuotas)
  if (!laneQuotas.ok) return laneQuotas
  const builtIn = await validateBuiltInServices(input)
  if (!builtIn.ok) return builtIn

  if (input.customOpenAi) {
    const validated = await validateOpenAiCompatibleProfile(
      input.customOpenAi,
      createAuditedValidationFetcher({
        provider: 'openai-compatible',
        funding: 'custom',
      }),
    )
    if (!validated.ok) return customOpenAiValidationError(validated)
  }

  if (input.customOpenAiTts) {
    const validated = await validateTtsProfile(
      input.customOpenAiTts,
      createAuditedValidationFetcher({
        provider: 'openai-compatible-tts',
        funding: 'custom',
      }),
    )
    if (!validated.ok) {
      return reject(
        422,
        `自定义兼容 TTS 端点校验失败${httpSuffix(validated.status)}，`
        + '请检查端点、模型、音色与音频格式',
      )
    }
  }

  if (input.customOpenAiAsr) {
    const validated = await validateAsrProfile(
      input.customOpenAiAsr,
      createAuditedValidationFetcher({
        provider: 'openai-compatible-asr',
        funding: 'custom',
      }),
    )
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

async function validateBuiltInServices(
  input: ProviderSettings,
): Promise<ProviderSettingsOutcome> {
  const entries = Object.entries(input.providerServices ?? {}) as Array<
    [ManagedProviderId, { funding: 'managed' | 'byok'; apiKey?: string }]
  >
  for (const [provider, service] of entries) {
    if (service.funding === 'managed') {
      if (service.apiKey !== undefined) {
        return reject(422, '平台托管模式不接受用户 API Key', false)
      }
      continue
    }
    if (!service.apiKey) {
      const existing = await getAiConfigDependencies().credentials.describe(
        currentWorkspaceId(),
        provider,
      )
      if (!existing.configured) {
        return reject(422, '切换到自有 Key 前请先填写并验证 API Key', false)
      }
      continue
    }
    if (!await validateByok(provider, service.apiKey)) {
      return reject(422, `${providerLabel(provider)} API Key 校验失败`, false)
    }
  }
  return OK
}

async function validateByok(
  provider: ManagedProviderId,
  apiKey: string,
): Promise<boolean> {
  const fetcher = createAuditedValidationFetcher({
    provider,
    funding: 'byok',
  })
  return validateOfficialByokKey(provider, apiKey, fetcher)
}

function providerLabel(provider: ManagedProviderId): string {
  return PROVIDER_REGISTRY[provider].label
}

/**
 * ISSUE-011: renderShot 上限依赖运行期 CPU 数，schema 无法静态表达上限——
 * 在写入任何 secret / models / routes / laneQuotas 之前做二次校验。
 */
function checkLaneQuotas(
  laneQuotas: ProviderSettings['laneQuotas'],
): ProviderSettingsOutcome {
  if (!laneQuotas) return OK
  const cpuCount = os.cpus().length
  return laneQuotas.renderShotConcurrency > cpuCount
    ? reject(400, `渲染并发数不可超过 CPU 核数 (${cpuCount})`)
    : OK
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
