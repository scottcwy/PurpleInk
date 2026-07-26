import type { StepfunConfigView, StepfunModelField } from '@/features/ai/config'
import type {
  GeminiConfigField,
  GeminiConfigView,
} from '@/features/ai/gemini-config'
import type {
  AiProviderId,
  DirectorRouteView,
} from '@/features/ai/model-routing'
import type { OpenAiCompatibleProfileView } from '@/features/ai/openai-compatible-config'
import type { CanvasNodeType } from '@/features/canvas/types'

export type StepfunDraft = Record<StepfunModelField, string>
export type GeminiDraft = Record<GeminiConfigField, string>
export type OpenAiCompatibleDraft = {
  baseUrl: string
  defaultModel: string
}
export type RouteDraft = Record<CanvasNodeType, AiProviderId>

export const STEPFUN_FIELDS: Array<[StepfunModelField, string]> = [
  ['baseUrl', '端点'],
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

export const OPENAI_COMPATIBLE_FIELDS: Array<[keyof OpenAiCompatibleDraft, string]> = [
  ['baseUrl', 'OpenAI 兼容端点'],
  ['defaultModel', '默认模型'],
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
  configured?: boolean
  models?: StepfunConfigView
  geminiConfigured?: boolean
  gemini?: GeminiConfigView
  customOpenAi?: OpenAiCompatibleProfileView
  routes?: Record<CanvasNodeType, DirectorRouteView>
  laneQuotas?: LaneQuotasView
  requiresRestart?: boolean
  error?: string
}

export interface ReadyModelSettingsController {
  ready: true
  data: SettingsResponse
  stepfunDraft: StepfunDraft
  geminiDraft: GeminiDraft
  customOpenAiDraft: OpenAiCompatibleDraft
  routes: RouteDraft
  laneQuotasDraft: LaneQuotasDraft
  busy?: string
  error?: string
  setStepfunField: (field: StepfunModelField, value: string) => void
  setGeminiField: (field: GeminiConfigField, value: string) => void
  setCustomOpenAiField: (field: keyof OpenAiCompatibleDraft, value: string) => void
  setRoute: (nodeType: CanvasNodeType, provider: AiProviderId) => void
  setLaneQuotaField: (
    field: keyof LaneQuotasDraft,
    value: string,
  ) => void
  submit: (
    payload: Record<string, unknown>,
    action: string,
  ) => Promise<boolean>
}
