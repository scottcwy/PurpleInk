import type { Transition } from 'motion/react'

/**
 * 动效 token 的 JS 镜像（供 motion 的 `transition` 使用）。
 * 与 globals.css 的 `--duration-*` / `--ease-*` 一一对应，权威源见
 * docs/conventions/motion-interaction.md §2。
 * motion 以「秒」为单位，故此处 duration 用秒表示。
 *
 * 新增档位必须同步改三处：globals.css 的 `:root`、globals.css 的 `@theme inline`
 * （`--transition-duration-*` 命名空间）、以及本文件。
 * `tokens.test.ts` 的同步测试会校验本文件与 globals.css 一致。
 */
export const DURATION = {
  fast: 0.12,
  base: 0.22,
  slow: 0.36,
  /** 营销叙事档，仅 (marketing) 段可用，见规范 §5.4。 */
  narrative: 0.3,
} as const

/** 三次贝塞尔控制点（与 CSS cubic-bezier 参数一致）。 */
export const EASE = {
  standard: [0.4, 0, 0.2, 1],
  emphasized: [0.22, 1, 0.36, 1],
  exit: [0.4, 0, 1, 1],
} as const

/** 默认过渡：标准曲线 + base 时长，用于绝大多数 UI 变化。 */
export const TRANSITION_BASE: Transition = {
  duration: DURATION.base,
  ease: EASE.standard,
}

/** 强调进入：面板展开 / 抽屉滑入。 */
export const TRANSITION_ENTER: Transition = {
  duration: DURATION.base,
  ease: EASE.emphasized,
}

/** 退出：抽屉滑出 / 元素离场，略快并加速。退出禁止用 spring（规范 §5.3）。 */
export const TRANSITION_EXIT: Transition = {
  duration: DURATION.fast,
  ease: EASE.exit,
}

/** 拖拽调宽时的「零动画」过渡，保证 1:1 跟手。 */
export const TRANSITION_INSTANT: Transition = { duration: 0 }

/** 营销叙事进入（仅 (marketing) 段）。 */
export const TRANSITION_NARRATIVE: Transition = {
  duration: DURATION.narrative,
  ease: EASE.emphasized,
}

/**
 * spatial 弹性三档（规范 §2.4）。
 *
 * 只用于位移 / 尺寸 / 布局（spatial）；颜色、透明度、滤镜（effects）禁止 spring——
 * opacity 不能 overshoot 到 1 以上，颜色不能弹出色域。
 *
 * 用 `visualDuration + bounce` 而非 `stiffness / damping`：visualDuration 是「视觉上
 * 到达目标的时间」，弹性部分主要发生在该时间之后，因此能与 DURATION 的时间轴对齐；
 * bounce 是单一可 review 的旋钮。代价是不吸收当前手势速度，故拖拽仍用 TRANSITION_INSTANT。
 *
 * bounce 与元素尺寸「反相关」：小控件弹一点有生气，大面积 overshoot 会被放大成果冻感。
 * 不要按「越慢越弹」的直觉设置。
 */
export const SPRING_BOUNCE_MAX = 0.25

/** 小控件：toggle knob、chip、按压回弹。 */
export const SPRING_SPATIAL_FAST: Transition = {
  type: 'spring',
  visualDuration: 0.18,
  bounce: 0.22,
}

/** 中等面：抽屉、面板、折叠、侧栏宽度。 */
export const SPRING_SPATIAL_DEFAULT: Transition = {
  type: 'spring',
  visualDuration: 0.28,
  bounce: 0.18,
}

/** 大面积：全屏转场。 */
export const SPRING_SPATIAL_SLOW: Transition = {
  type: 'spring',
  visualDuration: 0.42,
  bounce: 0.12,
}
