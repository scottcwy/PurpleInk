import type { Variants } from 'motion/react'
import {
  DURATION,
  EASE,
  SPRING_SPATIAL_DEFAULT,
  SPRING_SPATIAL_FAST,
  TRANSITION_EXIT,
} from '@/lib/motion/tokens'

export type OverlayMotionPreset =
  | 'dialog'
  | 'popover'
  | 'fade'
  | 'tooltip'
  | 'drawer-left'
  | 'drawer-right'

const ENTER_EFFECT = { duration: DURATION.fast, ease: EASE.standard }

export const OVERLAY_SCRIM_VARIANTS: Variants = {
  hidden: { opacity: 0, transition: TRANSITION_EXIT },
  visible: { opacity: 1, transition: ENTER_EFFECT },
}

const SCALE_CONTENT: Variants = {
  hidden: { opacity: 0, scale: 0.96, transition: TRANSITION_EXIT },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      scale: SPRING_SPATIAL_FAST,
      opacity: ENTER_EFFECT,
    },
  },
}

const TOOLTIP_CONTENT: Variants = {
  hidden: { opacity: 0, transition: TRANSITION_EXIT },
  visible: { opacity: 1, transition: ENTER_EFFECT },
}

const DRAWER_EXIT = { duration: DURATION.base, ease: EASE.exit }

const DRAWER_LEFT_CONTENT: Variants = {
  hidden: { x: '-100%', transition: DRAWER_EXIT },
  visible: { x: 0, transition: SPRING_SPATIAL_DEFAULT },
}

const DRAWER_RIGHT_CONTENT: Variants = {
  hidden: { x: '100%', transition: DRAWER_EXIT },
  visible: { x: 0, transition: SPRING_SPATIAL_DEFAULT },
}

export function overlayContentVariants(preset: OverlayMotionPreset): Variants {
  if (preset === 'tooltip' || preset === 'fade') return TOOLTIP_CONTENT
  if (preset === 'drawer-left') return DRAWER_LEFT_CONTENT
  if (preset === 'drawer-right') return DRAWER_RIGHT_CONTENT
  return SCALE_CONTENT
}
