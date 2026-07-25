import type { Transition } from 'motion/react'

/**
 * 动效 token 的 JS 镜像（供 motion 的 `transition` 使用）。
 * 与 globals.css 的 `--duration-*` / `--ease-*` 一一对应，权威源见
 * docs/designs/2026-07-23-design-system-inventory.md §3.8。
 * motion 以「秒」为单位，故此处 duration 用秒表示。
 */
export const DURATION = {
  fast: 0.12,
  base: 0.22,
  slow: 0.36,
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

/** 退出：抽屉滑出 / 元素离场，略快并加速。 */
export const TRANSITION_EXIT: Transition = {
  duration: DURATION.fast,
  ease: EASE.exit,
}

/** 拖拽调宽时的「零动画」过渡，保证 1:1 跟手。 */
export const TRANSITION_INSTANT: Transition = { duration: 0 }
