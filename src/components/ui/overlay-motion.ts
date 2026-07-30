import type { Variants } from 'motion/react'
import {
  DURATION,
  EASE,
  SPRING_SPATIAL_FAST,
  TRANSITION_EXIT,
} from '@/lib/motion/tokens'

export type OverlayMotionPreset = 'dialog' | 'popover' | 'tooltip'

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

export function overlayContentVariants(preset: OverlayMotionPreset): Variants {
  return preset === 'tooltip' ? TOOLTIP_CONTENT : SCALE_CONTENT
}
