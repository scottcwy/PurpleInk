import { shotRevisionBriefSchema } from '@/features/canvas/contracts'

/** 定向修改只是一种 shot-codegen regenerate 业务输入，不能改变其他恢复动作。 */
export function normalizeShotRevisionBrief(
  revisionBrief: string | undefined,
  intent: string,
  nodeType: string,
): string | undefined {
  if (revisionBrief === undefined) return undefined
  const normalized = shotRevisionBriefSchema.parse(revisionBrief)
  if (intent !== 'regenerate' || nodeType !== 'shot-codegen') {
    throw new Error('定向修改仅支持重新生成镜头代码')
  }
  return normalized
}
