import 'server-only'
import { LOCAL_WORKSPACE_ID } from '@/lib/db/client'
import { saveLaneQuotas } from '@/lib/queue/runtime-config'
import { getAiConfigDependencies, saveStepfunModelSettings } from './config'
import { saveGeminiApiKey, saveGeminiSettings } from './gemini-config'
import { saveMimoApiKey, saveMimoSettings } from './mimo-config'
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
import { saveApiKey } from './stepfun-adapter'

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
    ...modelSettings
  } = input
  try {
    if (routes) await saveDirectorRoutes(routes)
  } catch (error) {
    if (error instanceof RouteContractError) return reject(422, error.message, false)
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
  return OK
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
  const route = await deps.mediaRoutes.find(LOCAL_WORKSPACE_ID, kind)
  if (route?.provider !== provider || route.model === model) return
  await deps.mediaRoutes.save({
    workspaceId: LOCAL_WORKSPACE_ID,
    mediaTaskKind: kind,
    provider,
    model,
  })
}
