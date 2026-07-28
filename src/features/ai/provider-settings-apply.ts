import 'server-only'
import { currentWorkspaceId } from '@/lib/auth/workspace-context'
import { saveLaneQuotas } from '@/lib/queue/runtime-config'
import { getAiConfigDependencies, saveStepfunModelSettings } from './config'
import { saveGeminiSettings } from './gemini-config'
import { saveMimoSettings } from './mimo-config'
import { ManagedAiError } from './managed-service'
import { saveDirectorRoutes } from './model-routing'
import {
  CUSTOM_ASR_PROVIDER,
  CUSTOM_TTS_PROVIDER,
  saveAsrProfile,
  saveTtsProfile,
} from './openai-compatible-audio-config'
import { saveOpenAiCompatibleProfile } from './openai-compatible-config'
import {
  CONSERVATIVE_ASR_NEGOTIATION,
  OK,
  reject,
  type ProviderSettingsNegotiation,
  type ProviderSettingsOutcome,
} from './provider-settings-contract'
import {
  audioDependencies,
  customOpenAiDependencies,
} from './provider-settings-dependencies'
import { RouteContractError } from './route-contract-error'
import type { StepfunSettings } from './schemas'

/**
 * 执行写入。路由先落：`saveDirectorRoutes` 的能力合同错误属于设置面矛盾，
 * 必须在任何模型 / secret / 配额写入之前把整个请求拒掉。
 *
 * 非 `RouteContractError` 的异常继续向上抛，由 route 层变成 500——它代表基础设施
 * 故障，不能伪装成用户输入错误。
 */
export async function applyProviderSettings(
  input: StepfunSettings,
  negotiated: ProviderSettingsNegotiation = {},
): Promise<ProviderSettingsOutcome> {
  const {
    apiKey,
    gemini,
    mimo,
    routes,
    laneQuotas,
    customOpenAi,
    customOpenAiTts,
    customOpenAiAsr,
    fallbackProvider,
    ...modelSettings
  } = input
  const { apiKey: geminiApiKey, ...geminiSettings } = gemini ?? {}
  const { apiKey: mimoApiKey, ...mimoSettings } = mimo ?? {}
  if (
    apiKey !== undefined ||
    geminiApiKey !== undefined ||
    mimoApiKey !== undefined ||
    hasManagedModelInput(modelSettings, geminiSettings, mimoSettings)
  ) {
    return reject(422, '托管凭据与模型由服务端管理，不接受设置写入', false)
  }
  try {
    // 三个托管配置先完成无副作用预检，保证 baseUrl 合同失败时尚未落任何路由。
    await saveStepfunModelSettings(modelSettings)
    await saveGeminiSettings(geminiSettings)
    await saveMimoSettings(mimoSettings)
    const plan = await getAiConfigDependencies().currentPlan?.() ?? 'free'
    if (plan === 'free' && fallbackProvider === 'gemini') {
      return reject(422, 'Free 套餐不可使用 Gemini 托管服务', false)
    }
    if (routes) await saveDirectorRoutes(routes)
  } catch (error) {
    if (error instanceof RouteContractError || error instanceof ManagedAiError) {
      return reject(422, error.message, false)
    }
    throw error
  }
  if (customOpenAi) {
    await saveOpenAiCompatibleProfile(customOpenAi, customOpenAiDependencies())
  }
  if (customOpenAiTts) {
    await saveTtsProfile(customOpenAiTts, audioDependencies())
    await resyncMediaRoute('tts', CUSTOM_TTS_PROVIDER, customOpenAiTts.model)
  }
  if (customOpenAiAsr) {
    await saveAsrProfile(
      customOpenAiAsr,
      negotiated.asr ?? CONSERVATIVE_ASR_NEGOTIATION,
      audioDependencies(),
    )
    await resyncMediaRoute('asr', CUSTOM_ASR_PROVIDER, customOpenAiAsr.model)
  }
  if (laneQuotas) {
    await saveLaneQuotas({
      directorStage: laneQuotas.directorStageConcurrency,
      renderShot: laneQuotas.renderShotConcurrency,
    })
  }
  // 降级链备选：未提交不改已存值；null 显式清空。能力门禁已在
  // `validateProviderSettings` 拒过，这里只负责落库。
  if (fallbackProvider !== undefined) {
    await getAiConfigDependencies().fallbackProviders?.save(
      currentWorkspaceId(),
      fallbackProvider,
    )
  }
  return OK
}

function hasManagedModelInput(
  stepfun: object,
  gemini: object,
  mimo: object,
): boolean {
  return ['chatModel', 'ttsModel', 'asrModel', 'visionModel'].some((key) =>
    key in stepfun)
    || ['primaryModel', 'fastModel'].some((key) => key in gemini)
    || ['textModel', 'visionModel', 'ttsModel', 'asrModel'].some((key) =>
      key in mimo)
}

/**
 * 端点模型改动后，把指向该端点的媒体路由行同步到新模型。
 *
 * `media_routes.model` 是设置页「当前模型」与执行侧的共同真值。不同步的话，
 * 用户改了端点模型而路由行还是旧值，`narration.ts` 的 `assertEngine` 会以
 * 「TTS 模型与配置不一致」失败，而设置页仍显示旧模型——一条谎报。
 * 路由当前不指向该端点时不写入，避免顺手改掉用户选的 StepFun / MiMo。
 */
async function resyncMediaRoute(
  kind: 'tts' | 'asr',
  provider: typeof CUSTOM_TTS_PROVIDER | typeof CUSTOM_ASR_PROVIDER,
  model: string,
): Promise<void> {
  const deps = getAiConfigDependencies()
  const route = await deps.mediaRoutes.find(currentWorkspaceId(), kind)
  if (route?.provider !== provider || route.model === model) return
  await deps.mediaRoutes.save({
    workspaceId: currentWorkspaceId(),
    mediaTaskKind: kind,
    provider,
    model,
  })
}
