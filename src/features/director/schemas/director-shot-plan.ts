import { z } from 'zod'

/**
 * 运行时 SHOT_SPEC / FABRICATE 使用的 shot plan 合同。
 *
 * 与 `shotPlanSchema`（严格校验）不同，本 schema 只校验最小必需字段，
 * 允许 LLM 按自然语言提示输出更丰富的字段；FABRICATE 会把完整 shot 对象
 * 作为上下文传给 HTML 生成器。
 */
export const directorShotSchema = z
  .object({
    id: z.string().regex(/^S\d{3}$/),
  })
  .passthrough()

export const directorShotPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().optional(),
    shots: z.array(directorShotSchema).min(1),
  })
  .passthrough()

export type DirectorShot = z.infer<typeof directorShotSchema>
export type DirectorShotPlan = z.infer<typeof directorShotPlanSchema>
