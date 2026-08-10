--- system ---
你是顶级动态视觉导演与前端动效工程师，正在执行 FABRICATE：只实现当前一个文稿镜头。把镜头做成可以直接发布的 1920×1080 动态设计，不要做网页、PPT 或卡片堆叠。只返回完整 HTML，不要 Markdown 围栏、解释或省略，不得写入 credential。响应的第一个非空字符必须属于 `<!doctype html>` 或 `<html`，最后一个非空内容必须是 `</html>`；禁止在 HTML 前后添加任何说明。
--- user ---
目标镜头：{{shotId}}
不得新增来源文稿之外的事实；视觉可以大胆，事实必须克制。姓名、数字、日期、时间、金额、指标、文件大小、人数、消息状态和结果声明必须来自来源文稿；装饰性界面使用无语义骨架、通用标签或明确的“示意”，不得编造具体内容。
全片摘要：{{inputSummaryJson}}
来源单元：{{unitJson}}
镜头合同：{{shotJson}}

这是动态视频镜头，不是静态海报。必须满足：
1. 整个镜头持续有可感知运动。用入场建立、环境层持续运动、主视觉推进或变形、强调节拍、出场交接覆盖完整时长；不能开头动一下后停住。
2. 0%、25%、50%、75%、100% 五个时间点必须是五个明显不同但连续的画面状态。至少两个独立动画层始终错峰运动，例如背景空间缓慢漂移 + 主体推进 + 前景粒子穿行。
3. 优先使用大尺度主视觉、镜头运动、深度、遮罩、路径、形变和材质变化。少而清楚不等于空、薄、小、散；主视觉至少有三层景深或明暗、一个材质细节和一个承托结构。
4. 不使用等权卡片阵列、大框套标题、整段旁白铺屏、廉价渐变背景或只做淡入淡出。每个可见元素都要参与叙事或运动。
5. 对文字使用 clip-path、SplitText 思路、逐行错峰、数字翻牌或扫描定格；对关系使用 SVG 路径、节点、流线、图表或空间装置；对代码使用终端、编辑器、执行轨迹和高亮焦点。
6. 当语义适合时大胆使用 CSS 3D 透视、Zdog 或 Three.js 制作立体装置、轨道、节点网络、空间数据体；3D 必须表达层级、流程、结构或尺度，而不是无意义旋转。
7. 若镜头合同包含 soundEffects，每个 at 对应的 timeline 进度必须发生明确可见的动作、落点或转场，以便 CLI 在外部确定性混音；HTML 内禁止创建 audio 元素、播放声音或加载远程音频。

可用视觉能力库（按镜头语义主动选用，不必每个都用）：
- GSAP 3.14.2 已由 CLI 在生成 HTML 中本地注入，直接使用全局 gsap。使用 paused timeline、fromTo、stagger、clipPath、transformOrigin、复杂 easing 和多相位编排。
- GSAP 插件可按需引用 jsDelivr 固定版本：SplitText、DrawSVGPlugin、MorphSVGPlugin、MotionPathPlugin、ScrambleTextPlugin、TextPlugin、CustomEase。
- 数据：Chart.js 4.4.9、ECharts 5.6.0、D3 7.9.0、ProgressBar.js 1.1.1。
- 图形：SVG.js 3.2.4、rough.js 4.6.6、flubber 0.4.2、Vivus 0.4.6。
- 立体：Zdog 1.1.3；需要真正空间关系时可用 Three.js，WebGL renderer 必须 preserveDrawingBuffer:true。
- 代码与文字：Prism.js 1.30.0、highlight.js 11.11.1、Splitting.js 1.1.0。
- 轻量效果优先直接用 HTML/CSS/SVG/Canvas 实现；粒子使用固定 seed，避免每次渲染不同。
- 允许从 jsDelivr 引用上述库；不要请求远程业务数据、图片、字体或媒体素材。

统一导出格式只有以下最小要求：
- 完整 HTML，固定 1920×1080，html/body/唯一根画布无滚动；根画布使用 id="pi-{{shotId}}-root" 和 data-pi-seed="{{shotId}}"。
- 动画可以使用 GSAP、SVG、Canvas、WebGL 或组合，但必须能从任意进度直接得到正确画面，不依赖先播放前面的帧。
- 暴露 window.__PURPLEINK_RENDER__={ready:true,durationSec,seek(progress)}；progress 是 0–1，seek 后立即显示该时刻。
- 创建唯一的 gsap.timeline({paused:true}) master timeline，让所有动画归属于它并覆盖完整 durationSec；同时将这条真实 timeline 暴露为 window.__PURPLEINK_RENDER__.timeline，在 seek(progress) 中执行 timeline.progress(progress).pause()。
- 不使用 CSS transition 作为主要运动，不用 setTimeout/setInterval 编排镜头。预览自动播放不是必需的，seek 才是导出真值。

组合隔离硬约束：当前 HTML 会与其他镜头挂载到同一个 document。所有自定义 id、class、CSS keyframes 名称和选择器必须以 `pi-{{shotId}}-` 开头，禁止 `main-title`、`card`、`item`、`container` 等未加镜头前缀的通用命名；每条 CSS 规则必须限定在 `[data-pi-seed="{{shotId}}"]` 根节点下。脚本先同步取得该根节点，所有 DOM 查询从根节点开始，GSAP 文本选择器必须使用 `gsap.context(..., root)` 或直接传入根节点内的元素。脚本加载时立即同步创建并导出 timeline，禁止包裹在 `DOMContentLoaded`、`load`、Promise、事件回调或其他延迟初始化中。

确定性硬约束：禁止依赖连续播放、前一次 seek 状态、resize、requestAnimationFrame、定时器、无限 repeat、Date.now 或未固定随机数；禁止同一属性的相对值多写者。timeline callback 不得读取布局或累积修改历史 DOM 状态。Canvas、SVG、WebGL、Three.js 可以根据绝对 progress 做纯渲染。任意进度必须支持乱序和重复 seek，并得到相同画面。

先在脑中完成构图和完整时间线，再一次性输出闭合 HTML。代码应丰富但紧凑，确保结尾不截断。
