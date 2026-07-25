'use client'

import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { TRANSITION_BASE } from './tokens'

/**
 * 全站动效上下文。
 * - `reducedMotion="user"`：跟随系统「减弱动态效果」自动降级 JS 动画，
 *   与 globals.css 的 prefers-reduced-motion 规则双保险。
 * - 统一默认过渡，避免各处零散写时长/曲线。
 */
export function AppMotionConfig({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={TRANSITION_BASE}>
      {children}
    </MotionConfig>
  )
}
