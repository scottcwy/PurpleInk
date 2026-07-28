import type { StepfunConfigView, StepfunModelField } from '@/features/ai/config'
import type {
  GeminiConfigField,
  GeminiConfigView,
} from '@/features/ai/gemini-config'
import type {
  AiProviderId,
  DirectorRouteView,
} from '@/features/ai/model-routing'
import type {
  AsrProfileView,
  TtsProfileView,
} from '@/features/ai/openai-compatible-audio-config'
import type { OpenAiCompatibleAudioFormat } from '@/features/ai/openai-compatible-payloads'
import type { OpenAiCompatibleProfileView } from '@/features/ai/openai-compatible-config'
import type { MimoConfigField, MimoConfigView } from '@/features/ai/mimo-config'
import type { CanvasNodeType } from '@/features/canvas/types'
import type { PlanKey } from '@/features/billing'
import type {
  ManagedModelDefinition,
  ManagedProviderId,
  ProviderFunding,
} from '@/features/ai'

export type StepfunDraft = Record<StepfunModelField, string>
export type GeminiDraft = Record<GeminiConfigField, string>
export type MimoDraft = Record<MimoConfigField, string>
export type OpenAiCompatibleDraft = {
  baseUrl: string
  textModel: string
  visionModel: string
}
/**
 * 自定义兼容 TTS / ASR 端点的草稿。
 *
 * 三份端点各自独立，所以是三份 draft 而不是一份带可选字段的联合——把它们合成一份会
 * 让「只保存 TTS」这种操作携带另外两个端点的值。
 */
export type OpenAiCompatibleTtsDraft = {
  baseUrl: string
  model: string
  voice: string
  audioFormat: OpenAiCompatibleAudioFormat
}
export type OpenAiCompatibleAsrDraft = {
  baseUrl: string
  model: string
}
export type RouteDraft = Record<CanvasNodeType, AiProviderId>

export const STEPFUN_FIELDS: Array<[StepfunModelField, string]> = [
  ['baseUrl', '端点（普通 v1 或 Step Plan）'],
  ['chatModel', 'Chat 模型'],
  ['ttsModel', 'TTS 模型'],
  ['asrModel', 'ASR 模型'],
  ['visionModel', 'Vision 模型'],
]

export const GEMINI_FIELDS: Array<[GeminiConfigField, string]> = [
  ['baseUrl', 'OpenAI 兼容端点'],
  ['primaryModel', '主模型'],
  ['fastModel', '低延迟模型'],
]

export const MIMO_FIELDS: Array<[MimoConfigField, string]> = [
  ['baseUrl', '产品 API 端点'],
  ['textModel', '文本模型'],
  ['visionModel', '视觉模型'],
  ['ttsModel', '配音模型'],
  ['asrModel', '语音识别模型'],
]

export const OPENAI_COMPATIBLE_FIELDS: Array<[keyof OpenAiCompatibleDraft, string]> = [
  ['baseUrl', 'OpenAI 兼容端点'],
  ['textModel', '默认模型'],
  ['visionModel', '视觉模型'],
]

export const OPENAI_COMPATIBLE_TTS_FIELDS: Array<
  [Exclude<keyof OpenAiCompatibleTtsDraft, 'audioFormat'>, string]
> = [
  ['baseUrl', 'OpenAI 兼容端点'],
  ['model', 'TTS 模型 ID'],
  ['voice', '音色'],
]

export const OPENAI_COMPATIBLE_ASR_FIELDS: Array<
  [keyof OpenAiCompatibleAsrDraft, string]
> = [
  ['baseUrl', 'OpenAI 兼容端点'],
  ['model', 'ASR 模型 ID'],
]

export const ROUTE_ROWS: Array<[CanvasNodeType, string]> = [
  ['script-import', '脚本导入 / INGEST'],
  ['shot-split', '导演拆分 / DIRECT'],
  ['shot-script', '分镜合同 / SHOT_SPEC'],
  ['shot-codegen', '代码生成 / FABRICATE'],
  ['score', '全片编排 / ASSEMBLE'],
  ['shot-sfx', '配音规划 / ASSEMBLE'],
  ['shot-subtitle', '字幕规划 / ASSEMBLE'],
  ['shot-qa', '分镜验收 / FINALIZE'],
  ['export', '终片交付 / FINALIZE'],
]

export const MODEL_ROUTE_ROWS = ROUTE_ROWS.filter(([nodeType]) =>
  nodeType !== 'shot-sfx' && nodeType !== 'shot-subtitle',
)

/**
 * ISSUE-011 队列并发配额的只读视图。`source` 与 `features/ai/config.ts`
 * 的 `'settings' | 'env' | 'default'` 口径一致——UI 据此呈现真值来源,
 * 而不是把内部 env / DB / 默认三套来源混成单一数字。
 */
export type LaneQuotaSource = 'settings' | 'env' | 'default'

export interface LaneQuotaFieldView {
  value: number
  source: LaneQuotaSource
}

export interface LaneQuotasView {
  directorStage: LaneQuotaFieldView
  renderShot: LaneQuotaFieldView
}

export type LaneQuotasDraft = {
  directorStageConcurrency: string
  renderShotConcurrency: string
}

/** UI 层提交并发配额时使用的 schema 上限。运行期 renderShot 上限还受 CPU 数约束, 由 route 负责。 */
export const LANE_QUOTA_LIMITS = {
  directorStageMin: 1,
  directorStageMax: 32,
  renderShotMin: 1,
  renderShotMax: 128,
} as const

export interface SettingsResponse {
  planKey?: PlanKey
  managedProviders?: Array<{
    provider: ManagedProviderId
    configured: boolean
    funding: ProviderFunding
    managedConfigured: boolean
    byokCredential: {
      configured: boolean
      verifiedAt: string | null
      updatedAt: string | null
    }
    models: readonly ManagedModelDefinition[]
  }>
  availableCatalog?: readonly ManagedModelDefinition[]
  configured?: boolean
  models?: StepfunConfigView
  geminiConfigured?: boolean
  gemini?: GeminiConfigView
  mimoCredential?: { configured: boolean }
  mimo?: MimoConfigView
  customOpenAi?: OpenAiCompatibleProfileView
  customOpenAiTts?: TtsProfileView
  customOpenAiAsr?: AsrProfileView
  routes?: Record<CanvasNodeType, DirectorRouteView>
  laneQuotas?: LaneQuotasView
  requiresRestart?: boolean
  error?: string
  /** 仅 ASR 转写校验被端点拒绝时出现，客户端据此提供「仅校验凭据」。 */
  reason?: 'asr-transcription-rejected'
}

export interface ReadyModelSettingsController {
  ready: true
  data: SettingsResponse
  stepfunDraft: StepfunDraft
  geminiDraft: GeminiDraft
  mimoDraft: MimoDraft
  customOpenAiDraft: OpenAiCompatibleDraft
  customOpenAiTtsDraft: OpenAiCompatibleTtsDraft
  customOpenAiAsrDraft: OpenAiCompatibleAsrDraft
  routes: RouteDraft
  laneQuotasDraft: LaneQuotasDraft
  busy?: string
  error?: string
  setStepfunField: (field: StepfunModelField, value: string) => void
  setGeminiField: (field: GeminiConfigField, value: string) => void
  setMimoField: (field: MimoConfigField, value: string) => void
  setCustomOpenAiField: (field: keyof OpenAiCompatibleDraft, value: string) => void
  setCustomOpenAiTtsField: <K extends keyof OpenAiCompatibleTtsDraft>(
    field: K,
    value: OpenAiCompatibleTtsDraft[K],
  ) => void
  setCustomOpenAiAsrField: (
    field: keyof OpenAiCompatibleAsrDraft,
    value: string,
  ) => void
  setRoute: (nodeType: CanvasNodeType, provider: AiProviderId) => void
  setLaneQuotaField: (
    field: keyof LaneQuotasDraft,
    value: string,
  ) => void
  /**
   * 回传响应体而不是布尔：ASR 端点被拒时客户端要读 `reason` 决定是否提供
   * 「仅校验凭据」，只给成功/失败无法区分「转写被拒」和「凭据无效」。
   */
  submit: (
    payload: Record<string, unknown>,
    action: string,
  ) => Promise<{ ok: boolean; body: SettingsResponse }>
}
