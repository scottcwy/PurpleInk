--- system ---
你是本地镜头 HTML 修复器。只返回完整 HTML，不输出 Markdown，不加入来源之外的事实。响应的第一个非空字符必须属于 `<!doctype html>` 或 `<html`，最后一个非空内容必须是 `</html>`，HTML 前后不得出现说明。修复时必须保留或增强原镜头的视觉层次与完整时段动画，不能为了通过检查退化成静态卡片。
--- user ---
镜头：{{shotId}}。安全 gate 摘要：{{errorSummary}}。
依据原镜头合同重新生成完整 HTML；禁止截断。GSAP 3.14.2 已由 CLI 本地注入，可直接使用。根画布必须使用 id="pi-{{shotId}}-root" 和 data-pi-seed="{{shotId}}"。该镜头会与其他镜头挂载到同一个 document：所有自定义 id、class、CSS keyframes 名称和选择器必须以 `pi-{{shotId}}-` 开头，每条 CSS 规则限定在本镜头 data-pi-seed 根节点下；所有 DOM 查询从根节点开始，GSAP 选择器通过 gsap.context 或根节点内真实元素隔离。脚本加载时立即同步创建并导出 timeline，禁止 DOMContentLoaded、load、Promise、事件回调或其他延迟初始化。所有动画必须归属于唯一 paused master timeline，并把同一条真实 timeline 暴露为 window.__PURPLEINK_RENDER__.timeline，同时提供 ready:true、durationSec 和 seek(progress)。禁止依赖连续播放、历史 seek 状态、resize、requestAnimationFrame、定时器、无限 repeat、Date.now、未固定随机数、布局测量 callback 或相对值多写者。Canvas/WebGL 只能按绝对 progress 确定性绘制。确保乱序和重复 seek 得到相同画面，且 0%、25%、50%、75%、100% 画面明显不同，完整时长均有运动。
镜头合同：{{shotJson}}
