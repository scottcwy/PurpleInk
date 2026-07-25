import type { StepfunConfigView, StepfunModelField } from '@/features/ai/config'
import type {
  GeminiConfigField,
  GeminiConfigView,
} from '@/features/ai/gemini-config'
import type {
  AiProviderId,
  DirectorRouteView,
} from '@/features/ai/model-routing'
import type { CanvasNodeType } from '@/features/canvas/types'

export type StepfunDraft = Record<StepfunModelField, string>
export type GeminiDraft = Record<GeminiConfigField, string>
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

export interface SettingsResponse {
  configured?: boolean
  models?: StepfunConfigView
  geminiConfigured?: boolean
  gemini?: GeminiConfigView
  routes?: Record<CanvasNodeType, DirectorRouteView>
  error?: string
}

export interface ReadyModelSettingsController {
  ready: true
  data: SettingsResponse
  stepfunDraft: StepfunDraft
  geminiDraft: GeminiDraft
  routes: RouteDraft
  busy?: string
  error?: string
  setStepfunField: (field: StepfunModelField, value: string) => void
  setGeminiField: (field: GeminiConfigField, value: string) => void
  setRoute: (nodeType: CanvasNodeType, provider: AiProviderId) => void
  submit: (
    payload: Record<string, unknown>,
    action: string,
  ) => Promise<boolean>
}
