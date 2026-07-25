'use client'

import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { scrimFade, slideInLeft, slideInRight } from '@/lib/motion/variants'
import { TRANSITION_BASE, TRANSITION_INSTANT } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'

export interface AnimatedAsideProps {
  /** 目标宽度（px）。变化时以标准曲线缓动。 */
  width: number
  /** 拖拽调宽时置 false，关闭动画保证 1:1 跟手。 */
  animateWidth?: boolean
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * 在流内的可缓动侧栏。宽度变化（展开↔收起）走标准过渡，
 * 首帧用 `initial={false}` 避免挂载时的“撑开”动画。
 */
export function AnimatedAside({
  width,
  animateWidth = true,
  className,
  style,
  children,
}: AnimatedAsideProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width }}
      transition={animateWidth ? TRANSITION_BASE : TRANSITION_INSTANT}
      style={{ ...style, width }}
      className={cn('shrink-0 overflow-hidden', className)}
    >
      {children}
    </motion.aside>
  )
}

export interface DrawerOverlayProps {
  open: boolean
  onDismiss: () => void
  /** 抽屉贴靠的一侧。 */
  side?: 'left' | 'right'
  /** 作用到滑动面板容器。 */
  className?: string
  style?: CSSProperties
  scrimLabel?: string
  children: ReactNode
}

/**
 * 抽屉遮罩：scrim 淡入淡出 + 面板从边缘滑入/滑出（AnimatePresence 管理进出场）。
 * 窄屏 / 自动收起态复用它，保证全站抽屉动效一致。
 */
export function DrawerOverlay({
  open,
  onDismiss,
  side = 'left',
  className,
  style,
  scrimLabel = '关闭遮罩',
  children,
}: DrawerOverlayProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.button
          key="scrim"
          type="button"
          aria-label={scrimLabel}
          className="fixed inset-0 z-40 bg-scrim"
          variants={scrimFade}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onDismiss}
        />
      )}
      {open && (
        <motion.div
          key="panel"
          className={cn(
            'fixed inset-y-0 z-50 shadow-float',
            side === 'left' ? 'left-0' : 'right-0',
            className,
          )}
          style={style}
          variants={side === 'left' ? slideInLeft : slideInRight}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
