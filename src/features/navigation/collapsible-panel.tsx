'use client'

import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'motion/react'
import { OverlayRoot } from '@/components/ui/overlay-root'
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
 * 抽屉遮罩：由 OverlayRoot 接管 top layer、Escape、焦点约束与滚动锁，
 * 面板按统一抽屉预设从边缘进出。
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
    <OverlayRoot
      mode="modal"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss()
      }}
      ariaLabel={scrimLabel}
      layoutClassName="relative block p-0"
      preset={side === 'left' ? 'drawer-left' : 'drawer-right'}
      className={cn(
        'fixed inset-y-0 shadow-float',
        side === 'left' ? 'left-0' : 'right-0',
        className,
      )}
      style={style}
    >
      {children}
    </OverlayRoot>
  )
}
