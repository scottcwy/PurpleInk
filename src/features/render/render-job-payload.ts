import { z } from 'zod'
import { shotRevisionBriefSchema } from '@/features/canvas/contracts'

/**
 * `render-shot` 的持久化队列合同。
 *
 * revisionBrief 只是一条受限业务命令；完整 Provider prompt、Tool 参数与模型输出
 * 不进入队列 payload 或公共投影。
 */
export const renderJobPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    forceRender: z.boolean().optional(),
    regenerateSource: z.boolean().optional(),
    revisionBrief: shotRevisionBriefSchema.optional(),
  })
  .strict()
  .refine(
    (payload) => payload.regenerateSource || payload.revisionBrief === undefined,
    { message: 'revisionBrief 仅允许用于重新生成镜头代码' },
  )

export type RenderShotInput = z.infer<typeof renderJobPayloadSchema>
