import type { Variants } from 'motion/react'
import { TRANSITION_BASE, TRANSITION_ENTER, TRANSITION_EXIT } from './tokens'

/** 右侧内容进入：轻微上浮淡入（页面切换 template 使用）。 */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: TRANSITION_ENTER },
}

/** 遮罩淡入淡出（抽屉 scrim）。 */
export const scrimFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TRANSITION_ENTER },
  exit: { opacity: 0, transition: TRANSITION_EXIT },
}

/** 左缘抽屉滑入（左侧栏在窄屏的抽屉态）。 */
export const slideInLeft: Variants = {
  hidden: { x: '-100%' },
  visible: { x: 0, transition: TRANSITION_ENTER },
  exit: { x: '-100%', transition: TRANSITION_EXIT },
}

/** 右缘抽屉滑入（Inspector / 分镜列 / 导出设置的抽屉态）。 */
export const slideInRight: Variants = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: TRANSITION_ENTER },
  exit: { x: '100%', transition: TRANSITION_EXIT },
}

/** 内容区高度收起/展开（可折叠卡片：CollapsibleCard 的展开/收起）。 */
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0, transition: TRANSITION_EXIT },
  visible: { height: 'auto', opacity: 1, transition: TRANSITION_BASE },
}
