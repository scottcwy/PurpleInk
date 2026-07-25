import { z } from 'zod'

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
  routes: z
    .object({
      'script-import': z.enum(['stepfun', 'gemini']).optional(),
      'shot-split': z.enum(['stepfun', 'gemini']).optional(),
      score: z.enum(['stepfun', 'gemini']).optional(),
      export: z.enum(['stepfun', 'gemini']).optional(),
      'shot-script': z.enum(['stepfun', 'gemini']).optional(),
      'shot-codegen': z.enum(['stepfun', 'gemini']).optional(),
      'shot-sfx': z.enum(['stepfun', 'gemini']).optional(),
      'shot-subtitle': z.enum(['stepfun', 'gemini']).optional(),
      'shot-qa': z.enum(['stepfun', 'gemini']).optional(),
    })
    .strict()
    .optional(),
}).strict()

export type StepfunSettings = z.infer<typeof stepfunSettingsSchema>
