/** 确定性违规规则：视频必须是 f(frame)，同帧同画面。 */
export interface DeterminismRule {
  id: string
  pattern: RegExp
  message: string
}

/**
 * 禁止出现在 shot 渲染代码（HTML / JS / CSS）中的非确定性来源。
 * 说明：仅约束视频 shot 渲染，不约束应用 UI（见架构规范「确定性边界」）。
 */
export const DETERMINISM_RULES: DeterminismRule[] = [
  { id: 'raf', pattern: /\brequestAnimationFrame\b/, message: '禁止 requestAnimationFrame；用每帧 seek 驱动' },
  { id: 'date-now', pattern: /\bDate\.now\s*\(/, message: '禁止 Date.now()；时间只来自 frame' },
  { id: 'perf-now', pattern: /\bperformance\.now\s*\(/, message: '禁止 performance.now()；时间只来自 frame' },
  { id: 'math-random', pattern: /\bMath\.random\s*\(/, message: '禁止无种子 Math.random()；随机须由 seed 派生' },
  { id: 'gsap-ticker', pattern: /\bgsap\.ticker\b/, message: '禁止 gsap.ticker；用 paused timeline + seek' },
  { id: 'set-timeout', pattern: /\bsetTimeout\s*\(/, message: '禁止 setTimeout 驱动动画；用帧取模表达' },
  { id: 'set-interval', pattern: /\bsetInterval\s*\(/, message: '禁止 setInterval 驱动动画；用帧取模表达' },
  { id: 'css-animation', pattern: /(?:^|[^-\w])animation\s*:/, message: '禁止 CSS animation；用 seek 驱动' },
  { id: 'css-transition', pattern: /(?:^|[^-\w])transition\s*:/, message: '禁止 CSS transition；用 seek 驱动' },
]
