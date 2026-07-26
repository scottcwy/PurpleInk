import { z } from 'zod'
import { AI_PROVIDER_IDS } from './provider-registry'

const textProviderSchema = z.enum(AI_PROVIDER_IDS)
const mediaProviderSchema = z.enum(['stepfun', 'mimo'])

/**
 * ISSUE-011 队列并发配额输入：
 *   - `directorStageConcurrency` 影响纯 LLM I/O 阶段，硬上限 32（实测 Gemini 16
 *     路无限流、留 2x 余量）；
 *   - `renderShotConcurrency` 影响 Chromium + ffmpeg 渲染，schema 兜底 128；
 *     route 层再做 `<= os.cpus().length` 的运行时校验（机器不同，CPU 数不同）。
 *
 * 该字段为可选；未提交时不改已存值。提交时需两个子字段同时给出——
 * 不接受部分写入，避免把「director-stage 改了但 render-shot 漂回默认」这种语义糊。
 */
export const laneQuotasSchema = z
  .object({
    directorStageConcurrency: z
      .number()
      .int('Director 并发必须为整数')
      .min(1, 'Director 并发必须 >= 1')
      .max(32, 'Director 并发必须 <= 32'),
    renderShotConcurrency: z
      .number()
      .int('渲染并发必须为整数')
      .min(1, '渲染并发必须 >= 1')
      .max(128, '渲染并发必须 <= 128'),
  })
  .strict()
  .optional()

/**
 * StepFun 设置输入：Key 可选（未提交则不改动已存 Key）；4 类模型 + 端点
 * 均可选，允许显式提交空串以清空该项（回退 env/默认）。
 */
export const stepfunSettingsSchema = z.object({
  apiKey: z.string().min(1, 'API Key 不能为空').optional(),
  baseUrl: z.string().optional(),
  chatModel: z.string().optional(),
  ttsModel: z.string().optional(),
  asrModel: z.string().optional(),
  visionModel: z.string().optional(),
  gemini: z
    .object({
      apiKey: z.string().min(1, 'Gemini API Key 不能为空').optional(),
      baseUrl: z.string().optional(),
      primaryModel: z.string().optional(),
      fastModel: z.string().optional(),
    })
    .strict()
    .optional(),
  mimo: z
    .object({
      apiKey: z.string().min(1, 'MiMo API Key 不能为空').optional(),
      baseUrl: z.string().optional(),
      textModel: z.string().optional(),
      visionModel: z.string().optional(),
      ttsModel: z.string().optional(),
      asrModel: z.string().optional(),
    })
    .strict()
    .optional(),
  customOpenAi: z
    .object({
      apiKey: z.string().min(1, 'OpenAI 兼容 API Key 不能为空'),
      baseUrl: z.string().min(1, 'OpenAI 兼容端点不能为空'),
      defaultModel: z.string().min(1, 'OpenAI 兼容默认模型不能为空'),
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

export type StepfunSettings = z.infer<typeof stepfunSettingsSchema>
export type LaneQuotasSettingsInput = z.infer<typeof laneQuotasSchema>
