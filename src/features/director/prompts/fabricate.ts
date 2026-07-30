import { z } from 'zod'
import { audioAllocationSchema } from '../schemas/ingest'
import { directorShotSchema } from '../schemas/director-shot-plan'
import {
  DEFAULT_VISUAL_THEME,
  visualThemeConstraint,
  visualThemeSchema,
} from './visual-theme'

export const fabricatePromptInputSchema = z
  .object({
    shot: directorShotSchema,
    audioAllocation: audioAllocationSchema,
    styleBible: z.string().min(1),
    visualTheme: visualThemeSchema.default(DEFAULT_VISUAL_THEME),
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
export function buildFabricatePrompt(
  input: z.input<typeof fabricatePromptInputSchema>
): string {
  const parsed = fabricatePromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 FABRICATE 阶段，只实现当前分镜。

优先保证视觉效果：用最能把本镜头叙述内容可视化、最有价值的前端设计来呈现；
对产品界面、数据、流程等内容尽量高质量还原；具体设计方向由你自行决策。
代码层面请拿出你的最强能力：充分使用 GSAP 高级特性（clip-path 揭示、
transform-origin 精准控制、贝塞尔缓动、错峰入场、多相位编排），
用尽可能丰富的动效优化画面表现力。
镜头全时长内尽量保持画面有可感知的运动：入场、持续微动或环境层漂移、
强调节拍、出场可以错峰叠加；一镜可按内容需要叠加多种动画效果
（主动画 + 环境层持续运动 + 强调节拍）。运动必须服务内容与节奏，
克制不堆砌，禁止为动而动。

视觉重量与克制（与上面的丰富度要求冲突时，优先级为：单一核心判断 > 视觉重量 > 细节与动效丰富度）：
- 本镜只承担一个核心判断；同层级、同尺寸、同样式的信息组不超过 3 个，
  等权卡片阵列不得充当主视觉，画面空时用尺度与层级填，不用卡片数量填。
- 主视觉即使元素很少也必须有完整视觉重量：足够尺度、至少 3 层明暗或景深层次、
  清晰轮廓或块面、至少一项材质细节、一个承托结构（基座、地平线、网格或投影锚点）。
- 细线 SVG 必须构成完整、可命名、有意图的结构（装置、流程、剖面）：描边闭合或与块面配合，
  stroke-width 相对 1920 母版不小于 2px，禁止孤立短线、散点和无锚定的细框。
- 空白必须服务构图、层级、视线、情绪或运动；不服务任何一项的空白要靠放大主视觉吃掉。

正向视觉法则 10：所有重要可见元素必须位于 TitleRegion、HeroRegion、SupportRegion 或通用 VisualRegion，并带稳定 QA 标识。

确定性红线（任何一项出现都判失败）：
- 禁止 requestAnimationFrame、gsap.ticker、Date.now()、performance.now()。
- 禁止无种子 Math.random()。
- 禁止 setTimeout/setInterval 驱动动画。
- 禁止 CSS animation/transition。
- GSAP 只能使用 paused timeline，并由 frame/fps 显式 seek。
- 相同 frame、fps、seed 必须得到相同像素。

确定性动效库白名单（只能使用下列固定版本 CDN；所有库一律禁用自带播放/循环/rAF 能力，一切运动只能被 seek(frame, fps) 单向驱动）：
- 核心：GSAP@3.14.2 https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js —— paused timeline + 显式 seek —— 一切编排的唯一驱动。
- GSAP 官方插件（同版本，URL 格式 https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/插件名.min.js，注册进同一 paused timeline）：SplitText（文字切分错峰入场）、DrawSVGPlugin（线绘揭示）、MorphSVGPlugin（形状变形）、MotionPathPlugin（路径运动）、ScrambleTextPlugin（乱序文字定格）、TextPlugin（打字机效果必须用它，禁止 Typed.js）、CustomEase（自定义缓动曲线）。
- 数据可视化：Chart.js@4.4.9 https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js —— animation:false，seek 内改数据后 update('none') —— 柱/线/饼图；
  ECharts@5.6.0 https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js —— animation:false 静态渲染 —— 复杂图表；
  d3@7.9.0 https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js —— 纯函数式，进度由 frame 计算 —— 自定义数据图形；
  ProgressBar.js@1.1.1 https://cdn.jsdelivr.net/npm/progressbar.js@1.1.1/dist/progressbar.min.js —— set(progress) 手动驱动 —— 进度/环形指标。
- 代码与文本：Prism.js@1.30.0 https://cdn.jsdelivr.net/npm/prismjs@1.30.0/prism.min.js 或 highlight.js@11.11.1 https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js —— 静态高亮 —— 代码演示；
  Splitting.js@1.1.0 https://cdn.jsdelivr.net/npm/splitting@1.1.0/dist/splitting.min.js —— 切分后交 GSAP 错峰 —— 字符级动画。
- SVG/图形：Vivus@0.4.6 https://cdn.jsdelivr.net/npm/vivus@0.4.6/dist/vivus.min.js —— 手动 progress —— SVG 线绘；
  rough.js@4.6.6 https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js —— 固定 seed 静态绘制 —— 手绘风图形；
  SVG.js@3.2.4 https://cdn.jsdelivr.net/npm/@svgdotjs/svg.js@3.2.4/dist/svg.min.js —— 只做静态构建，运动交 GSAP —— SVG 场景搭建；
  flubber@0.4.2 https://cdn.jsdelivr.net/npm/flubber@0.4.2/build/flubber.min.js —— 插值器进度由 frame 驱动 —— 路径形状过渡。
- 伪 3D：zdog@1.1.3 https://cdn.jsdelivr.net/npm/zdog@1.1.3/dist/zdog.dist.min.js —— seek 内更新 rotate 后 updateRenderGraph() —— 轻量立体图形。
- 粒子：不引库；用 seeded PRNG + 纯函数位置计算自写，粒子位置必须是 frame 的纯函数。
- 明确禁止：three.js、p5.js、pixi.js、Babylon.js 以及任何白名单之外的 CDN。

截帧兼容性（headless 逐帧截图环境，违反会导致空帧或内容缺失）：
- 禁止 video/audio 元素；多媒体表现用 Canvas/DOM 重建。
- 尽量避免 WebGL；确需使用时必须 preserveDrawingBuffer: true，否则截图为空。
- 图片一律内联 data URL 并显式 loading="eager"；禁止外链图片。
- 禁止依赖 :hover/:focus 等交互态呈现内容；需要该状态时用 GSAP 直接设定。
- 字体必须在 head 内静态声明（内联 data URL @font-face）；禁止运行时动态加载字体。
- 避免 backdrop-filter（跨平台渲染差异），改用 filter 或半透明叠层替代。
- 保持 overflow: hidden，杜绝滚动条参与布局。

实现约束：
- 唯一母版固定 1920×1080；viewport 必须明确写为 width=1920, height=1080。
- 唯一根画布必须带 data-composition-id、data-width="1920"、data-height="1080"。
- html、body 与根画布固定为 1920px × 1080px，overflow: hidden，禁止滚动，
  禁止通过 vw/vh、百分比或媒体查询自适应成其他画幅。
- TitleRegion、HeroRegion、SupportRegion、VisualRegion 全部必须位于 16:9 横屏安全区内。
- 一节点只允许一个 transform writer；静态外层与动画内层分离。
- 画面必须满足 shot 的 mustShow，且不得出现 mustAvoid。
- 不读取远程运行时素材，不改写镜头职责、音频时长或核心文案。
- HTML 必须可从任意 StorageAdapter 本地路径独立加载，不得引用工作区相对
  node_modules/docs 路径；除上述白名单 CDN 库外，其余运行时代码与素材必须
  内联或使用 data URL；禁止白名单之外的任何远程请求。
- 必须在内联脚本中暴露精确合同：
  window.__CVC_RENDER__ = { version: 1, seek(frame, fps) }
  seek 必须同步或返回 Promise，并只根据传入的 frame/fps 更新当前帧。
- 输出的第一个字符必须是 <，最后一个字符必须是 >；禁止 Markdown 围栏、
  解释、前后缀或省略内容。
- 完整 HTML 必须控制在 64000 个字符以内；避免无意义重复节点与超长 Base64 素材，
  禁止为凑长度堆无意义代码。必须在预算内完整闭合文档并调用工具，
  不能因追求细节输出半截 HTML。
- ${visualThemeConstraint(parsed.visualTheme)}

style bible：
${parsed.styleBible}
audio allocation（项目级共享时序）：
${JSON.stringify(parsed.audioAllocation)}
shot contract（当前镜头专属合同）：
${JSON.stringify(parsed.shot)}

提交方式：必须调用 check_determinism 工具，把完整 HTML 作为 source 实参提交，不要把实参当作普通文本输出。
工具返回违规时，按返回的错误逐条修订后再次调用同一工具。

提交的必须是完整、自包含且可被确定性守卫扫描的 HTML。`
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
修正违规时不得为通过门禁而删减视觉细节、动效或设计质量；本会话历史中的 style bible、shot contract 与视觉法则仍然全部有效，修正后的版本必须保持同等或更高的视觉丰富度。
修正后不得把主视觉退化为空、薄、小、散，也不得靠增加等权卡片补足画面。
重新输出完整 HTML，不要输出补丁、解释、Markdown 围栏或省略内容；最终 HTML 仍须自包含并满足 window.__CVC_RENDER__@v1。`
}
