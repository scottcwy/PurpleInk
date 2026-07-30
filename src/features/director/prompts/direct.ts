import { z } from 'zod'
import {
  audioAllocationSchema,
  audioManifestSchema,
  scriptUnitsSchema,
} from '../schemas/ingest'
import {
  DEFAULT_VISUAL_THEME,
  DEFAULT_VISUAL_STYLE,
  visualStyleConstraint,
  visualStyleSchema,
  visualThemeConstraint,
  visualThemeSchema,
} from './visual-theme'

export const directPromptInputSchema = z
  .object({
    projectTitle: z.string().min(1),
    scriptUnits: scriptUnitsSchema,
    audioManifest: audioManifestSchema.optional(),
    audioAllocation: audioAllocationSchema.optional(),
    visualTheme: visualThemeSchema.default(DEFAULT_VISUAL_THEME),
    visualStyle: visualStyleSchema.default(DEFAULT_VISUAL_STYLE),
    customVisualStyle: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

export type DirectPromptInput = z.infer<typeof directPromptInputSchema>

/** 构建 DIRECT 阶段的 master plan 与 style bible 提示词。 */
export function buildDirectPrompt(
  input: z.input<typeof directPromptInputSchema>
): string {
  const parsed = directPromptInputSchema.parse(input)
  const styleConstraint = visualStyleConstraint(
    parsed.visualStyle,
    parsed.customVisualStyle,
  )
  return `你正在执行 CodeVideoCanvas 的 DIRECT 阶段，为「${parsed.projectTitle}」建立导演总纲。

必须产出 master plan 与完整 style bible：
- master plan：全片主张、语义板块、每块输入/输出认知、视觉增幅、节奏剪辑、校准镜与风险。
- style bible：世界观、色彩职责、中文排版、形状材质、背景演进、构图重量、运动 ownership、共享组件和禁止项。
- 明确 2–3 个代表性校准镜；校准未通过不得批量制作。
- 不把原稿逐句换成卡片，不引入原文之外的确定性事实。
- master plan 必须按「一镜一个核心判断」逐 unit 规划，每镜承载内容少而精；
  相邻镜头必须变化拓扑、视角或信息职责。
- 同一帧内同层级、同尺寸、同样式的信息组不超过 3 个；等权卡片阵列不得充当主视觉，
  画面不足时用尺度与层级打破等权，不靠堆叠卡片填充。
- ${visualThemeConstraint(parsed.visualTheme)}
${styleConstraint ? `- ${styleConstraint}\n` : ''}  style bible 的色彩职责必须服从上述色调硬约束。

正向视觉法则 1：一镜只承担一个核心判断，同时保持低语义负载与高感知完成度。
正向视觉法则 2：少而清楚不能变成空、薄、小、散；主视觉即使元素很少，也必须靠足够尺度、明暗层次、清晰轮廓或块面、材质细节和承托结构（基座、地平线、网格或投影锚点）形成完整视觉重量。
正向视觉法则 3：大型容器必须承载真实信息或运动职责，禁止大框只放标题。
正向视觉法则 4：每一处空白都要服务构图、层级、视线、情绪或运动。
正向视觉法则 5：每镜必须提供定义、因果、对比、过程、证据、尺度、层级、不确定性或 affect/orient/pace/recall 增幅。

script units：
${JSON.stringify(parsed.scriptUnits)}
音频时序（异步生成；未就绪时只按文本规划，不得编造时长）：
${JSON.stringify(
  parsed.audioManifest && parsed.audioAllocation
    ? { audioManifest: parsed.audioManifest, audioAllocation: parsed.audioAllocation }
    : { status: 'pending' }
)}

输出两个有明确标题的文本区块：MASTER_PLAN 与 STYLE_BIBLE。`
}
