import { z } from 'zod'
import { AUDIO_FORMATS } from './openai-compatible-payloads'
import { AI_PROVIDER_IDS } from './provider-registry'

const textProviderSchema = z.enum(AI_PROVIDER_IDS)
const fundingSchema = z.enum(['managed', 'byok'])
const builtInServiceSchema = z.object({
  funding: fundingSchema,
  apiKey: z.string().min(1, 'API Key 不能为空').optional(),
}).strict()
/**
 * 媒体路由候选。Gemini 不可用于 TTS/ASR，而两个自定义音频端点各只承担一种能力——
 * 更细的「TTS 路由不能选 ASR 端点」由 `assertProviderCapability` 在
 * `saveDirectorRoutes` 里按 capability 兜住。
 */
const mediaProviderSchema = z.enum([
  'stepfun',
  'mimo',
  'openai-compatible-tts',
  'openai-compatible-asr',
])

/**
 * 用户设置只允许修改 Chromium + ffmpeg 渲染并发，schema 兜底 128；
 *     route 层再做 `<= os.cpus().length` 的运行时校验（机器不同，CPU 数不同）。
 * Director 进程并发只允许运维通过 env/既有进程配置调整，不接受普通设置 API 写入。
 */
export const laneQuotasSchema = z
  .object({
    renderShotConcurrency: z
      .number()
      .int('渲染并发必须为整数')
      .min(1, '渲染并发必须 >= 1')
      .max(128, '渲染并发必须 <= 128'),
  })
  .strict()
  .optional()

export const providerSettingsSchema = z.object({
  providerServices: z.object({
    stepfun: builtInServiceSchema.optional(),
    gemini: builtInServiceSchema.optional(),
    mimo: builtInServiceSchema.optional(),
    openai: builtInServiceSchema.optional(),
    anthropic: builtInServiceSchema.optional(),
  }).strict().optional(),
  /**
   * 自定义兼容文本端点。`visionModel` 可选且允许空串——空串表示显式清空，
   * 该端点随后不能承担视觉路由。
   */
  customOpenAi: z
    .object({
      apiKey: z.string().min(1, 'OpenAI 兼容 API Key 不能为空'),
      baseUrl: z.string().min(1, 'OpenAI 兼容端点不能为空'),
      textModel: z.string().min(1, 'OpenAI 兼容文本模型不能为空'),
      visionModel: z.string().optional(),
    })
    .strict()
    .optional(),
  /**
   * 自定义兼容 TTS 端点。voice 与 audioFormat 必填：音色表由端点决定无法推断，
   * 容器格式受 measureAudio 的解码能力约束。
   */
  customOpenAiTts: z
    .object({
      apiKey: z.string().min(1, '自定义兼容 TTS API Key 不能为空'),
      baseUrl: z.string().min(1, '自定义兼容 TTS 端点不能为空'),
      model: z.string().min(1, '自定义兼容 TTS 模型不能为空'),
      voice: z.string().min(1, '自定义兼容 TTS 音色不能为空'),
      audioFormat: z.enum(AUDIO_FORMATS),
    })
    .strict()
    .optional(),
  /**
   * 自定义兼容 ASR 端点。不收 timestampMode——它是校验时协商出来的结果，
   * 让用户填等于允许他谎报端点能力。
   */
  customOpenAiAsr: z
    .object({
      apiKey: z.string().min(1, '自定义兼容 ASR API Key 不能为空'),
      baseUrl: z.string().min(1, '自定义兼容 ASR 端点不能为空'),
      model: z.string().min(1, '自定义兼容 ASR 模型不能为空'),
      credentialOnly: z.boolean().optional(),
    })
    .strict()
    .optional(),
  routes: z
    .object({
      'script-import': textProviderSchema.optional(),
      'shot-split': textProviderSchema.optional(),
      score: textProviderSchema.optional(),
      export: textProviderSchema.optional(),
      'shot-script': textProviderSchema.optional(),
      'shot-codegen': textProviderSchema.optional(),
      'shot-sfx': mediaProviderSchema.optional(),
      'shot-subtitle': mediaProviderSchema.optional(),
      'shot-qa': textProviderSchema.optional(),
    })
    .strict()
    .optional(),
  laneQuotas: laneQuotasSchema,
}).strict()

export type ProviderSettings = z.infer<typeof providerSettingsSchema>
export type LaneQuotasSettingsInput = z.infer<typeof laneQuotasSchema>
