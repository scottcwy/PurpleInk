'use client'

import type { ComponentProps } from 'react'
import Link from 'next/link'
import { motion, type HTMLMotionProps } from 'motion/react'
import {
  SPRING_SPATIAL_FAST,
  TRANSITION_INSTANT,
} from '@/lib/motion/tokens'

const MotionLink = motion.create(Link)
const PRESS_TARGET = {
  y: 1,
  transition: TRANSITION_INSTANT,
} as const

/** 按下立即位移，松开统一走小控件 spring。 */
export function ControlPressButton(props: HTMLMotionProps<'button'>) {
  return (
    <motion.button
      data-motion-press
      whileTap={PRESS_TARGET}
      transition={SPRING_SPATIAL_FAST}
      {...props}
    />
  )
}

/** 导航控件与按钮共享同一按压意图。 */
export function ControlPressLink(props: ComponentProps<typeof MotionLink>) {
  return (
    <MotionLink
      data-motion-press
      whileTap={PRESS_TARGET}
      transition={SPRING_SPATIAL_FAST}
      {...props}
    />
  )
}

export function ToggleMotionKnob({
  checked,
  className,
}: {
  checked: boolean
  className?: string
}) {
  return (
    <motion.span
      data-motion-spring
      initial={false}
      animate={{ x: checked ? 18 : 0 }}
      transition={SPRING_SPATIAL_FAST}
      className={className}
    />
  )
}
