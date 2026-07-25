import { z } from 'zod'
import { shotAllocationSchema } from '../schemas/ingest'
import {
  directorShotPlanSchema,
  directorShotSchema,
} from '../schemas/director-shot-plan'

// ── FINALIZE · export（全局单例：全片终审与交付）──────────────────────

export const exportFinalizePromptInputSchema = z
  .object({
    shotPlan: directorShotPlanSchema,
    draftArtifactKey: z.string().min(1),
    qaFindings: z.array(z.string().min(1)),
  })
  .strict()

export type ExportFinalizePromptInput = z.infer<typeof exportFinalizePromptInputSchema>

/** 构建 FINALIZE · export 阶段的全片最终 QA 与交付提示词。 */
export function buildExportFinalizePrompt(input: ExportFinalizePromptInput): string {
  const parsed = exportFinalizePromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 FINALIZE 阶段（export 全局节点）。

最终门禁：
- 检查真实 Main 成片，不以单镜预览替代。
- 核对音画同步、字幕、镜头边界、均匀抽帧、区块入口/出口与稳定尾帧。
- TypeScript、UTF-8、素材许可、确定性、时间线或必需元素失败均为硬 BLOCK。
- 修复后只复验受影响证据，最终输出必须通过 ffprobe 并登记本地产物。
- 不对视觉主观偏好作无依据改写；只处理可定位的功能性或合同性问题。

shot plan：
${JSON.stringify(parsed.shotPlan)}
draft artifact key：${parsed.draftArtifactKey}
已知 QA findings：
${JSON.stringify(parsed.qaFindings)}

返回结构化的通过/阻塞结论、证据与需要重做的 shot IDs。`
}

// ── FINALIZE · shot-qa（分镜通道：验收单个分镜）──────────────────────

export const shotQaPromptInputSchema = z
  .object({
    shot: directorShotSchema,
    renderedArtifactKey: z.string().min(1),
    shotAllocation: shotAllocationSchema,
  })
  .strict()

export type ShotQaPromptInput = z.infer<typeof shotQaPromptInputSchema>

/** 构建 FINALIZE · shot-qa 阶段的单镜验收提示词。 */
export function buildShotQaPrompt(input: ShotQaPromptInput): string {
  const parsed = shotQaPromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 FINALIZE 阶段（shot-qa 分镜通道），只验收当前这一个分镜。

验收门禁：
- 只核对 shot allocation 描述的这一个分镜的渲染产物，不涉及全片成片。
- 核对画面时长与 shot allocation 的 durationInFrames 是否一致。
- 核对 shot 的 mustShow 是否兑现、mustAvoid 是否出现。
- 确定性、UTF-8、时间线或必需元素失败均为硬 BLOCK。
- 不对视觉主观偏好作无依据改写；只处理可定位的功能性或合同性问题。

shot contract：
${JSON.stringify(parsed.shot)}
rendered artifact key：${parsed.renderedArtifactKey}
shot allocation：
${JSON.stringify(parsed.shotAllocation)}

返回该分镜结构化的通过/阻塞结论与证据；若阻塞需指明该分镜是否需要重做。`
}
