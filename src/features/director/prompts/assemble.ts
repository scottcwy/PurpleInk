import { z } from 'zod'
import {
  audioAllocationSchema,
  scriptUnitSchema,
  shotAllocationSchema,
} from '../schemas/ingest'
import {
  directorShotPlanSchema,
  directorShotSchema,
} from '../schemas/director-shot-plan'

// ── ASSEMBLE · score（全局单例：全片配乐编排 + 合成清单）────────────────

export const scoreAssemblePromptInputSchema = z
  .object({
    styleBible: z.string().min(1),
    shotPlan: directorShotPlanSchema,
    audioAllocation: audioAllocationSchema,
    renderedArtifactKeys: z.array(z.string().min(1)).min(1),
  })
  .strict()

export type ScoreAssemblePromptInput = z.infer<typeof scoreAssemblePromptInputSchema>

/** 构建 ASSEMBLE · score 阶段的全片编排与草稿合成提示词。 */
export function buildScoreAssemblePrompt(input: ScoreAssemblePromptInput): string {
  const parsed = scoreAssemblePromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 ASSEMBLE 阶段（score 全局节点）。

只编排已验证的镜头产物，不重新逐帧渲染镜头：
1. 按 shot plan 顺序拼接 rendered artifact。
2. 音频、字幕与镜头边界必须以 audio allocation 为唯一时间依据。
3. 配乐基调、情绪与色彩必须对齐 style bible。
4. 默认使用硬切；只有合同明确要求时使用转场或 J/L cut。
5. 生成草稿成片与可追踪的合成清单；任一缺失产物必须结构化失败。

style bible：
${parsed.styleBible}
shot plan：
${JSON.stringify(parsed.shotPlan)}
audio allocation：
${JSON.stringify(parsed.audioAllocation)}
rendered artifact keys：
${JSON.stringify(parsed.renderedArtifactKeys)}

返回合成清单，不虚构不存在的本地路径。`
}

// ── ASSEMBLE · shot-sfx（分镜通道：为单个分镜配音效）──────────────────

export const shotSfxPromptInputSchema = z
  .object({
    shot: directorShotSchema,
    scriptUnit: scriptUnitSchema,
    shotAllocation: shotAllocationSchema,
    renderedArtifactKey: z.string().min(1),
    styleBible: z.string().min(1),
  })
  .strict()

export type ShotSfxPromptInput = z.infer<typeof shotSfxPromptInputSchema>

/** 构建 ASSEMBLE · shot-sfx 阶段的单镜音效提示词。 */
export function buildShotSfxPrompt(input: ShotSfxPromptInput): string {
  const parsed = shotSfxPromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 ASSEMBLE 阶段（shot-sfx 分镜通道），只为当前这一个分镜配音效。

约束：
1. 只处理 shot allocation 描述的这一个分镜，不涉及其它分镜或全片。
2. 音效落点（起止帧/时长）必须以 shot allocation 为唯一时间依据，不得越界到相邻分镜。
3. 音效音色、密度与力度必须对齐 style bible 的整体调性。
4. 优先兑现 shot 的 sfxCues，并尊重 mustShow / mustAvoid；不虚构画面里不存在的动作音。
5. 渲染产物仅作节奏参照，不重新渲染画面。

shot contract：
${JSON.stringify(parsed.shot)}
script unit（真实配音文本）：
${JSON.stringify(parsed.scriptUnit)}
shot allocation：
${JSON.stringify(parsed.shotAllocation)}
rendered artifact key：${parsed.renderedArtifactKey}
style bible：
${parsed.styleBible}

返回该分镜的音效清单与落点，不虚构不存在的本地路径。`
}

// ── ASSEMBLE · shot-subtitle（分镜通道：为单个分镜生成字幕）────────────

export const shotSubtitlePromptInputSchema = z
  .object({
    shot: directorShotSchema,
    scriptUnit: scriptUnitSchema,
    shotAllocation: shotAllocationSchema,
  })
  .strict()

export type ShotSubtitlePromptInput = z.infer<typeof shotSubtitlePromptInputSchema>

/** 构建 ASSEMBLE · shot-subtitle 阶段的单镜字幕提示词。 */
export function buildShotSubtitlePrompt(input: ShotSubtitlePromptInput): string {
  const parsed = shotSubtitlePromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 ASSEMBLE 阶段（shot-subtitle 分镜通道），只为当前这一个分镜生成字幕。

约束：
1. 只处理 shot allocation 描述的这一个分镜，不涉及其它分镜或全片。
2. 字幕文本必须可追溯到 script unit 的原文，不得杜撰、改写含义或引入原文之外的事实。
3. 字幕时间轴（起止帧/时长）必须以 shot allocation 为唯一时间依据。
4. 与画面 onScreenText 协调，避免与镜头内已有文字重复冗余。

shot contract：
${JSON.stringify(parsed.shot)}
script unit：
${JSON.stringify(parsed.scriptUnit)}
shot allocation：
${JSON.stringify(parsed.shotAllocation)}

返回该分镜的字幕文本与时间轴，字幕文本必须源自 script unit 原文。`
}
