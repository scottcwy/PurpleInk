import { z } from 'zod'
import { audioAllocationSchema } from '../schemas/ingest'
import { directorShotSchema } from '../schemas/director-shot-plan'

export const fabricatePromptInputSchema = z
  .object({
    shot: directorShotSchema,
    audioAllocation: audioAllocationSchema,
    styleBible: z.string().min(1),
  })
  .strict()

export type FabricatePromptInput = z.infer<typeof fabricatePromptInputSchema>

const retryPromptInputSchema = z
  .object({
    retry: z.number().int().positive(),
    maxRetries: z.number().int().positive(),
    errors: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()

/** 构建 FABRICATE 阶段的确定性 HTML+GSAP 生成提示词。 */
export function buildFabricatePrompt(input: FabricatePromptInput): string {
  const parsed = fabricatePromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 FABRICATE 阶段，只实现当前分镜。

正向视觉法则 10：所有重要可见元素必须位于 TitleRegion、HeroRegion、SupportRegion 或通用 VisualRegion，并带稳定 QA 标识。

确定性红线（任何一项出现都判失败）：
- 禁止 requestAnimationFrame、gsap.ticker、Date.now()、performance.now()。
- 禁止无种子 Math.random()。
- 禁止 setTimeout/setInterval 驱动动画。
- 禁止 CSS animation/transition。
- GSAP 只能使用 paused timeline，并由 frame/fps 显式 seek。
- 相同 frame、fps、seed 必须得到相同像素。

实现约束：
- 一节点只允许一个 transform writer；静态外层与动画内层分离。
- 画面必须满足 shot 的 mustShow，且不得出现 mustAvoid。
- 不读取远程运行时素材，不改写镜头职责、音频时长或核心文案。
- HTML 必须可从任意 StorageAdapter 本地路径独立加载，不得引用工作区相对
  node_modules/docs 路径；所需运行时代码与素材必须内联或使用 data URL。
- 必须在内联脚本中暴露精确合同：
  window.__CVC_RENDER__ = { version: 1, seek(frame, fps) }
  seek 必须同步或返回 Promise，并只根据传入的 frame/fps 更新当前帧。
- 输出的第一个字符必须是 <，最后一个字符必须是 >；禁止 Markdown 围栏、
  解释、前后缀或省略内容。

shot contract：
${JSON.stringify(parsed.shot)}
audio allocation：
${JSON.stringify(parsed.audioAllocation)}
style bible：
${parsed.styleBible}

只返回完整、自包含且可被确定性守卫扫描的 HTML。`
}

/** 把可信确定性门禁的逐条违规反馈回同一 FABRICATE 会话。 */
export function buildFabricateRetryPrompt(
  input: z.input<typeof retryPromptInputSchema>
): string {
  const parsed = retryPromptInputSchema.parse(input)
  return `上一版 HTML 未通过 CodeVideoCanvas 的确定性门禁，正在执行第 ${parsed.retry}/${parsed.maxRetries} 次自动修正。

可信门禁逐条违规：
${parsed.errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}

只修正这些违规及其直接影响，不改变 shot 职责、文案、时长、视觉合同或已正确部分。
重新输出完整 HTML，不要输出补丁、解释、Markdown 围栏或省略内容；最终 HTML 仍须自包含并满足 window.__CVC_RENDER__@v1。`
}
