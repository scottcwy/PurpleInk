import { z } from 'zod'

export const SHOT_REVISION_BRIEF_MAX_LENGTH = 200

/**
 * 用户对单镜新版 HTML 的局部修改简报。
 *
 * 这是受限业务输入，不是可覆盖镜头事实、时长或确定性合同的系统提示。
 */
export const shotRevisionBriefSchema = z
  .string()
  .trim()
  .min(1, '请输入修改要求')
  .max(
    SHOT_REVISION_BRIEF_MAX_LENGTH,
    `修改要求不能超过 ${SHOT_REVISION_BRIEF_MAX_LENGTH} 字`,
  )

export type ShotRevisionBrief = z.infer<typeof shotRevisionBriefSchema>
